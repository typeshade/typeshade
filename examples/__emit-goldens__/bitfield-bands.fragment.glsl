#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  int band = int((uv.x * 4.0));
  band &= 3;
  band |= 0;
  int shade = band;
  int amount = int((uv.y * 2.0));
  uint _gv0 = uint(amount);
  shade <<= _gv0;
  shade >>= _gv0;
  shade <<= 1u;
  shade >>= 1u;
  shade ^= 0;
  vec3 rgb;
  rgb = vec3(0.0, 0.0, 0.0);
  switch (shade) {
    case 0: {
      rgb = vec3(0.1, 0.1, 0.12);
      break;
    }
    case 1: {
      rgb = vec3(0.95, 0.55, 0.2);
      break;
    }
    case 2: {
      if ((uv.y > 0.5)) {
        rgb = vec3(0.2, 0.5, 0.95);
        break;
      }
      rgb = vec3(0.15, 0.35, 0.7);
      break;
    }
    default: {
      rgb = vec3(0.85, 0.85, 0.9);
    }
  }
  color = vec4(rgb, 1.0);
}
