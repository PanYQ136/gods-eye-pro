/**
 * X-ray — inverted-luminance negative with cyan-blue edge emphasis.
 * Dark imagery turns pale and structure pops via a luma edge boost: a
 * forensic / inspection look.
 */
export const xrayShader = {
  name: 'xray',
  uniforms: {
    edge: { default: 0.6, min: 0, max: 1, label: 'Edge Boost' },
    lift: { default: 0.12, min: 0, max: 1, label: 'Shadow Lift' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float edge;
    uniform float lift;
    in vec2 v_textureCoordinates;

    float lumaAt(vec2 uv) {
      return dot(texture(colorTexture, uv).rgb, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec2 texel = 1.0 / colorTextureDimensions;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      float l = lumaAt(uv + vec2(-texel.x, 0.0));
      float r = lumaAt(uv + vec2( texel.x, 0.0));
      float u = lumaAt(uv + vec2(0.0,  texel.y));
      float d = lumaAt(uv + vec2(0.0, -texel.y));
      float e = clamp(length(vec2(r - l, u - d)) * 3.2, 0.0, 1.0);

      float inv = 1.0 - luma;
      vec3 col = vec3(inv * (1.0 - lift) + lift);
      col += vec3(0.18, 0.42, 0.62) * e * edge;

      out_FragColor = vec4(mix(color.rgb, col, intensity), color.a);
    }
  `,
};
