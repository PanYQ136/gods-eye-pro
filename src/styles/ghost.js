/**
 * Ghost recon — cold, high-contrast blue-grey drone-recon look.
 * Crushes shadows toward near-black, lifts highlights to a pale cyan, and adds
 * a faint sensor-noise grain.
 */
export const ghostShader = {
  name: 'ghost',
  uniforms: {
    contrast: { default: 0.55, min: 0, max: 1, label: 'Contrast' },
    noise: { default: 0.35, min: 0, max: 1, label: 'Sensor Noise' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float contrast;
    uniform float noise;
    in vec2 v_textureCoordinates;

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      float lo = mix(0.02, 0.18, 1.0 - contrast);
      float hi = mix(1.10, 0.72, 1.0 - contrast);
      float g = smoothstep(lo, hi, luma);

      vec3 cold = mix(vec3(0.015, 0.05, 0.09), vec3(0.72, 0.92, 1.0), g);

      float n = fract(sin((uv.x * colorTextureDimensions.x + uv.y * colorTextureDimensions.y * 1.37) * 12.9898) * 43758.5453);
      cold += (n - 0.5) * 0.05 * noise;

      out_FragColor = vec4(mix(color.rgb, cold, intensity), color.a);
    }
  `,
};
