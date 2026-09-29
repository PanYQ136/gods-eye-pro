/**
 * Predator / Ironbow — colorized thermal. Maps luminance through a classic
 * ironbow ramp (black → indigo → red → orange → yellow-white), so hot targets
 * glow warm and cold sea/sky stays dark. Pairs with Strong gain for a
 * "drone strike feed" read.
 */
export const predatorShader = {
  name: 'predator',
  uniforms: {
    gain: { default: 0.35, min: 0, max: 1, label: 'Thermal Gain' },
    tint: { default: 0.25, min: 0, max: 1, label: 'Color Mix' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float gain;
    uniform float tint;
    in vec2 v_textureCoordinates;

    vec3 ironbow(float t) {
      t = clamp(t, 0.0, 1.0);
      vec3 c = mix(vec3(0.01, 0.01, 0.06), vec3(0.20, 0.02, 0.32), smoothstep(0.00, 0.25, t));
      c = mix(c, vec3(0.62, 0.06, 0.16), smoothstep(0.25, 0.50, t));
      c = mix(c, vec3(0.98, 0.55, 0.05), smoothstep(0.50, 0.75, t));
      c = mix(c, vec3(1.00, 0.95, 0.72), smoothstep(0.75, 1.00, t));
      return c;
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float t = clamp((luma - 0.5) * (1.0 + gain * 1.6) + 0.5, 0.0, 1.0);
      vec3 col = mix(color.rgb, ironbow(t), tint);
      out_FragColor = vec4(mix(color.rgb, col, intensity), color.a);
    }
  `,
};
