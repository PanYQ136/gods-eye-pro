/**
 * Cinema — the classic teal-and-orange blockbuster grade.
 * Teal shadows, warm highlights, a gentle S-curve and slight desaturation.
 */
export const cinemaShader = {
  name: 'cinema',
  uniforms: {
    grade: { default: 0.5, min: 0, max: 1, label: 'Split Tone' },
    contrast: { default: 0.5, min: 0, max: 1, label: 'Contrast' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float grade;
    uniform float contrast;
    in vec2 v_textureCoordinates;

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      vec3 col = color.rgb;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));

      // Split-tone: teal in the shadows, orange in the highlights.
      vec3 shadowTint = vec3(0.02, 0.72, 0.86);
      vec3 highTint = vec3(1.0, 0.62, 0.18);
      vec3 tint = mix(shadowTint, highTint, smoothstep(0.22, 0.82, luma));
      col = mix(col, col + (tint - 0.5) * 0.35, grade);

      // Gentle S-curve contrast.
      float k = 1.0 + contrast * 0.45;
      col = clamp((col - 0.5) * k + 0.5, 0.0, 1.0);

      // Slight desaturation for filmic feel.
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(g), col, 0.9);

      out_FragColor = vec4(mix(color.rgb, col, intensity), color.a);
    }
  `,
};
