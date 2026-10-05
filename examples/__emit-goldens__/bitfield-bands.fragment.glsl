#version 300 es
precision highp float;
precision highp int;

int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  int band = _f2i((uv.x * 4.0));
  band &= 3;
  band |= 0;
  int shade = band;
  int amount = _f2i((uv.y * 2.0));
  uint _gv0 = uint(amount);
  shade = (shade << (_gv0 & 31u));
  shade = (shade >> (_gv0 & 31u));
  shade <<= 1u;
  shade >>= 1u;
  shade ^= 0;
  vec3 rgb = vec3(0.0);
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
