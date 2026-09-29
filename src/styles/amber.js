/**
 * Amber phosphor CRT — a vintage amber-monochrome monitor look.
 * Luma-driven amber tint with a soft scanline gate; distinct from the green
 * phosphor `retro` style.
 */
export const amberShader = {
  name: 'amber',
  uniforms: {
    warmth: { default: 0.5, min: 0, max: 1, label: 'Amber Warmth' },
    scan: { default: 0.6, min: 0, max: 1, label: 'Scanline' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float warmth;
    uniform float scan;
    in vec2 v_textureCoordinates;

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Amber base (deep orange-red) vs. a warmer yellow pick by warmth.
      vec3 amber = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.78, 0.30), warmth);
      float scanline = 1.0 - scan * 0.35 * (0.5 + 0.5 * sin(uv.y * colorTextureDimensions.y * 1.6));
      float glow = pow(clamp(luma, 0.0, 1.0), 0.85);
      vec3 toned = amber * glow * scanline;

      out_FragColor = vec4(mix(color.rgb, toned, intensity), color.a);
    }
  `,
};
