varying vec3 vColor;

void main() {
    float distance = length(gl_PointCoord - vec2(0.5));
    if (distance > 0.5) {
        discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
}
