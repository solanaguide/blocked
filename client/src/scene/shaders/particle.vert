attribute float size;
attribute vec3 color;

varying vec3 vColor;

void main() {
    vColor = color;
    // position is automatically provided by Three.js
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
