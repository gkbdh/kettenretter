// website/vendor/orb/OrbShader.frag
var OrbShader_default = "#version 300 es\nprecision highp float;\nout vec4 outColor;\n\nuniform float uTime;\nuniform float uAnimation;\nuniform float uInverted;\nuniform float uOffsets[7];\nuniform vec3 uColor1;\nuniform vec3 uColor2;\nuniform float uInputVolume;\nuniform float uOutputVolume;\nuniform float uOpacity;\nuniform sampler2D uPerlinTexture;\nin vec2 vUv;\n\nconst float PI = 3.14159265358979323846;\n\n// Draw a single oval with soft edges and calculate its gradient color\nbool drawOval(vec2 polarUv, vec2 polarCenter, float a, float b, bool reverseGradient, float softness, out vec4 color) {\n    vec2 p = polarUv - polarCenter;\n    float oval = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);\n\n    float edge = smoothstep(1.0, 1.0 - softness, oval);\n\n    if (edge > 0.0) {\n        float gradient = reverseGradient ? (1.0 - (p.x / a + 1.0) / 2.0) : ((p.x / a + 1.0) / 2.0);\n        // Flatten gradient toward middle value for more uniform appearance\n        gradient = mix(0.5, gradient, 0.1);\n        color = vec4(vec3(gradient), 0.85 * edge);\n        return true;\n    }\n    return false;\n}\n\n// Map grayscale value to a 4-color ramp (color1, color2, color3, color4)\nvec3 colorRamp(float grayscale, vec3 color1, vec3 color2, vec3 color3, vec3 color4) {\n    if (grayscale < 0.33) {\n        return mix(color1, color2, grayscale * 3.0);\n    } else if (grayscale < 0.66) {\n        return mix(color2, color3, (grayscale - 0.33) * 3.0);\n    } else {\n        return mix(color3, color4, (grayscale - 0.66) * 3.0);\n    }\n}\n\nvec2 hash2(vec2 p) {\n    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);\n}\n\n// 2D noise for the ring\nfloat noise2D(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    \n    vec2 u = f * f * (3.0 - 2.0 * f);\n    float n = mix(\n        mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),\n            dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),\n        mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),\n            dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),\n        u.y\n    );\n\n    return 0.5 + 0.5 * n;\n}\n\nfloat sharpRing(vec3 decomposed, float time) {\n    float ringStart = 1.0;\n    float ringWidth = 0.3;\n    float noiseScale = 5.0;\n\n    float noise = mix(\n        noise2D(vec2(decomposed.x, time) * noiseScale),\n        noise2D(vec2(decomposed.y, time) * noiseScale),\n        decomposed.z\n    );\n\n    noise = (noise - 0.5) * 2.5;\n\n    return ringStart + noise * ringWidth * 1.5;\n}\n\nfloat smoothRing(vec3 decomposed, float time) {\n    float ringStart = 0.9;\n    float ringWidth = 0.2;\n    float noiseScale = 6.0;\n\n    float noise = mix(\n        noise2D(vec2(decomposed.x, time) * noiseScale),\n        noise2D(vec2(decomposed.y, time) * noiseScale),\n        decomposed.z\n    );\n\n    noise = (noise - 0.5) * 5.0;\n\n    return ringStart + noise * ringWidth;\n}\n\nfloat flow(vec3 decomposed, float time) {\n    return mix(\n        texture(uPerlinTexture, vec2(time, decomposed.x / 2.0)).r,\n        texture(uPerlinTexture, vec2(time, decomposed.y / 2.0)).r,\n        decomposed.z\n    );\n}\n\nvoid main() {\n    // Normalize vUv to be centered around (0.0, 0.0)\n    vec2 uv = vUv * 2.0 - 1.0;\n\n    // Convert uv to polar coordinates\n    float radius = length(uv);\n    float theta = atan(uv.y, uv.x);\n    if (theta < 0.0) theta += 2.0 * PI; // Normalize theta to [0, 2*PI]\n\n    // Decomposed angle is used for sampling noise textures without seams:\n    // float noise = mix(sample(decomposed.x), sample(decomposed.y), decomposed.z);\n    vec3 decomposed = vec3(\n        // angle in the range [0, 1]\n        theta / (2.0 * PI),\n        // angle offset by 180 degrees in the range [1, 2]\n        mod(theta / (2.0 * PI) + 0.5, 1.0) + 1.0,\n        // mixing factor between two noises\n        abs(theta / PI - 1.0)\n    );\n\n    // Add noise to the angle for a flow-like distortion (reduced for flatter look)\n    float noise = flow(decomposed, radius * 0.03 - uAnimation * 0.2) - 0.5;\n    theta += noise * mix(0.08, 0.25, uOutputVolume);\n\n    // Initialize the base color to white\n    vec4 color = vec4(1.0, 1.0, 1.0, 1.0);\n\n    // Original parameters for the ovals in polar coordinates\n    float originalCenters[7] = float[7](0.0, 0.5 * PI, 1.0 * PI, 1.5 * PI, 2.0 * PI, 2.5 * PI, 3.0 * PI);\n\n    // Parameters for the animated centers in polar coordinates\n    float centers[7];\n    for (int i = 0; i < 7; i++) {\n        centers[i] = originalCenters[i] + 0.5 * sin(uTime / 20.0 + uOffsets[i]);\n    }\n\n    float a, b;\n    vec4 ovalColor;\n\n    // Check if the pixel is inside any of the ovals\n    for (int i = 0; i < 7; i++) {\n        float noise = texture(uPerlinTexture, vec2(mod(centers[i] + uTime * 0.05, 1.0), 0.5)).r;\n        a = 0.5 + noise * 0.3; // Increased for more coverage\n        b = noise * mix(3.5, 2.5, uInputVolume); // Increased height for fuller appearance\n        bool reverseGradient = (i % 2 == 1); // Reverse gradient for every second oval\n\n        // Calculate the distance in polar coordinates\n        float distTheta = min(\n            abs(theta - centers[i]),\n            min(\n                abs(theta + 2.0 * PI - centers[i]),\n                abs(theta - 2.0 * PI - centers[i])\n            )\n        );\n        float distRadius = radius;\n\n        float softness = 0.6; // Increased softness for flatter, less pronounced edges\n\n        // Check if the pixel is inside the oval in polar coordinates\n        if (drawOval(vec2(distTheta, distRadius), vec2(0.0, 0.0), a, b, reverseGradient, softness, ovalColor)) {\n            // Blend the oval color with the existing color\n            color.rgb = mix(color.rgb, ovalColor.rgb, ovalColor.a);\n            color.a = max(color.a, ovalColor.a); // Max alpha\n        }\n    }\n    \n    // Calculate both noisy rings\n    float ringRadius1 = sharpRing(decomposed, uTime * 0.1);\n    float ringRadius2 = smoothRing(decomposed, uTime * 0.1);\n    \n    // Adjust rings based on input volume (reduced for flatter appearance)\n    float inputRadius1 = radius + uInputVolume * 0.2;\n    float inputRadius2 = radius + uInputVolume * 0.15;\n    float opacity1 = mix(0.2, 0.6, uInputVolume);\n    float opacity2 = mix(0.15, 0.45, uInputVolume);\n\n    // Blend both rings\n    float ringAlpha1 = (inputRadius2 >= ringRadius1) ? opacity1 : 0.0;\n    float ringAlpha2 = smoothstep(ringRadius2 - 0.05, ringRadius2 + 0.05, inputRadius1) * opacity2;\n    \n    float totalRingAlpha = max(ringAlpha1, ringAlpha2);\n    \n    // Apply screen blend mode for combined rings\n    vec3 ringColor = vec3(1.0); // White ring color\n    color.rgb = 1.0 - (1.0 - color.rgb) * (1.0 - ringColor * totalRingAlpha);\n\n    // Define colours to ramp against greyscale (could increase the amount of colours in the ramp)\n    vec3 color1 = vec3(0.0, 0.0, 0.0); // Black\n    vec3 color2 = uColor1; // Darker Color\n    vec3 color3 = uColor2; // Lighter Color\n    vec3 color4 = vec3(1.0, 1.0, 1.0); // White\n\n    // Convert grayscale color to the color ramp\n    float luminance = mix(color.r, 1.0 - color.r, uInverted);\n    color.rgb = colorRamp(luminance, color1, color2, color3, color4); // Apply the color ramp\n\n    // Apply fade-in opacity\n    color.a *= uOpacity;\n\n    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;\n    color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(1.0 / 2.2));\n    color.rgb += grain * 0.055;\n    outColor = color;\n}\n";

// website/vendor/orb/OrbShader.vert
var OrbShader_default2 = "#version 300 es\nprecision highp float;\n\nin vec2 position;\n\nout vec2 vUv;\n\nvoid main() {\n  vUv = position * 0.5 + 0.5;\n  gl_Position = vec4(position, 0, 1);\n}\n";

// website/vendor/orb/Orb.ts
var POSITION_LOCATION = 0;
var QUAD_POSITIONS = new Float32Array([
  -1,
  1,
  -1,
  -1,
  1,
  1,
  1,
  -1
]);
var PERLIN_NOISE = "assets/voice/perlin-noise.png";
var Orb = class _Orb {
  static noiseImage;
  gl;
  program;
  startTime;
  targetSpeed = 0;
  speed = 0.5;
  rafId = null;
  resizeObserver;
  colorA = [0, 0, 0];
  colorB = [0, 0, 0];
  offsets = new Float32Array(7).map(() => Math.random() * Math.PI * 2);
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      depth: false,
      stencil: false
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    this.program = this.setupProgram(OrbShader_default, OrbShader_default2);
    if (false) {
      false.accept("./OrbShader.frag", (module) => {
        this.program = this.setupProgram(module.default, OrbShader_default2);
      });
    }
    const noise = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, noise);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255])
    );
    if (!_Orb.noiseImage) {
      _Orb.noiseImage = new Image();
      _Orb.noiseImage.crossOrigin = "anonymous";
      _Orb.noiseImage.src = PERLIN_NOISE;
    }
    if (_Orb.noiseImage.complete) {
      this.copyNoiseImage();
    } else {
      _Orb.noiseImage.addEventListener("load", this.copyNoiseImage);
    }
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_POSITIONS, gl.STATIC_DRAW);
    gl.vertexAttribPointer(POSITION_LOCATION, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(POSITION_LOCATION);
    this.updateColors("#2792DC", "#9CE6E6");
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const size = entry.devicePixelContentBoxSize ? entry.devicePixelContentBoxSize[0] : entry.contentBoxSize[0];
      canvas.width = Math.min(512, size.inlineSize);
      canvas.height = Math.min(512, size.blockSize);
      this.updateViewport();
    });
    const parent = canvas.parentElement;
    if (parent) {
      try {
        this.resizeObserver.observe(parent, {
          box: "device-pixel-content-box"
        });
      } catch (e) {
        this.resizeObserver.observe(parent);
      }
    }
    this.startTime = performance.now();
    this.rafId = requestAnimationFrame(this.render);
  }
  dispose() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver?.disconnect();
    _Orb.noiseImage?.removeEventListener("load", this.copyNoiseImage);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    this.program = null;
  }
  updateViewport() {
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }
  updateColors(a, b) {
    if (!this.gl) return;
    this.colorA = this.updateColor("uColor1", a) ?? this.colorA;
    this.colorB = this.updateColor("uColor2", b) ?? this.colorB;
  }
  updateVolume(input, output) {
    this.targetSpeed = 0.2 + (1 - Math.pow(output - 1, 2)) * 1.8;
    if (this.targetSpeed > this.speed) {
      this.speed = this.targetSpeed;
    }
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uInputVolume"),
      input
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uOutputVolume"),
      output
    );
  }
  updateColor(name, hex) {
    try {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const color = [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
      this.gl.uniform3fv(this.gl.getUniformLocation(this.program, name), color);
      return color;
    } catch (e) {
      console.error(`[ConversationalAI] Failed to parse ${hex} as color:`, e);
    }
  }
  setupProgram(fragmentCode, vertexCode) {
    const fragment = this.getShader(this.gl.FRAGMENT_SHADER, fragmentCode);
    const vertex = this.getShader(this.gl.VERTEX_SHADER, vertexCode);
    if (!fragment || !vertex) {
      throw new Error("Failed to compile shaders");
    }
    this.program = this.gl.createProgram();
    this.gl.attachShader(this.program, fragment);
    this.gl.attachShader(this.program, vertex);
    this.gl.linkProgram(this.program);
    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      if (false) {
        console.error(this.gl.getProgramInfoLog(this.program));
      }
      throw new Error("Failed to link program");
    }
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, "uOpacity"), 1);
    this.gl.uniform1i(
      this.gl.getUniformLocation(this.program, "uPerlinTexture"),
      0
    );
    this.gl.uniform1fv(
      this.gl.getUniformLocation(this.program, "uOffsets"),
      this.offsets
    );
    this.gl.uniform3fv(
      this.gl.getUniformLocation(this.program, "uColor1"),
      this.colorA
    );
    this.gl.uniform3fv(
      this.gl.getUniformLocation(this.program, "uColor2"),
      this.colorB
    );
    return this.program;
  }
  getShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      if (false) {
        console.error(this.gl.getShaderInfoLog(shader));
      }
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  copyNoiseImage = () => {
    if (!this.gl) {
      return;
    }
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      _Orb.noiseImage
    );
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  };
  toDataURL = () => {
    return this.gl.canvas.toDataURL("image/png");
  };
  render = () => {
    if (!this.gl) {
      this.rafId = null;
      return;
    }
    const time = (performance.now() - this.startTime) / 1e3;
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, "uAnimation"), time * (0.25 + this.targetSpeed * 0.2));
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, "uTime"), time);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.rafId = requestAnimationFrame(this.render);
  };
};
export {
  Orb
};
