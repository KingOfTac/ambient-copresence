import { css, customElement, FASTElement, html, observable, ref } from '@microsoft/fast-element';
import './style.css';
import PartySocket from 'partysocket';

const partySocket = new PartySocket({
  host: 'localhost:1999',
  room: 'my-room'
});

const vertexShaderSource = /*GLSL*/`
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position;
    gl_Position = vec4(a_position * 2.0 - 1.0, 0, 1);
  }
`;

const fragmentShaderSource = /*GLSL*/`
  precision mediump float;
  uniform vec2 u_center;
  uniform float u_radius;
  uniform vec2 u_resolution;
  varying vec2 v_uv;

  void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 center = u_center * u_resolution;
    float dist = distance(fragCoord, center);

    float circle = smoothstep(u_radius * u_resolution.x + 1.5, u_radius * u_resolution.x + 1.5, dist);
    vec3 color = mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 1.0, 1.0), circle);
    gl_FragColor = vec4(color, 1.0);
  }
`;

let vertexShader, fragmentShader;

function compileShader(gl: WebGLRenderingContext, source: string, type: GLenum) {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

const template = html<App>`
  <canvas ${ref('canvas')} width="800" height="400"></canvas>
`;

const styles = css`
  :host {
    display: contents;
    position: relative;
  }
  
  canvas {
  }

  :host::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    backdrop-filter: blur(320px);
  }
`;

@customElement({ name: 'my-app', template, styles })
class App extends FASTElement {
  @observable
  public canvas!: HTMLCanvasElement;
  private canvasChanged() {
    if (this.canvas instanceof HTMLCanvasElement) {
      this.gl = this.canvas.getContext('webgl');
    }
  }

  @observable
  private gl: WebGLRenderingContext | null = null;

  public connectedCallback(): void {
    super.connectedCallback();

    if (this.gl) {
      vertexShader = compileShader(this.gl, vertexShaderSource, this.gl.VERTEX_SHADER) as WebGLShader;
      fragmentShader = compileShader(this.gl, fragmentShaderSource, this.gl.FRAGMENT_SHADER) as WebGLShader;

      const program = this.gl.createProgram();
      this.gl.attachShader(program, vertexShader);
      this.gl.attachShader(program, fragmentShader);
      this.gl.linkProgram(program);

      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        console.error(this.gl.getProgramInfoLog(program));
      }

      this.gl.useProgram(program);

      const positions = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1
      ]);

      const positionBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

      const aPositionLocation = this.gl.getAttribLocation(program, 'a_position');
      this.gl.enableVertexAttribArray(aPositionLocation);
      this.gl.vertexAttribPointer(aPositionLocation, 2, this.gl.FLOAT, false, 0, 0);

      const uCenterLocation = this.gl.getUniformLocation(program, 'u_center');
      const uRadiusLocation = this.gl.getUniformLocation(program, 'u_radius');
      const uResolutionLocation = this.gl.getUniformLocation(program, 'u_resolution');

      this.gl.uniform2f(uResolutionLocation , this.canvas.width, this.canvas.height);

      let center = { x: 0.5, y: 0.5 };
      let velocity = { x: 0.02, y: 0.03 };
      let connectionCount = 1;
      let scaleFactor = 0.01;
      let lastTime = performance.now();

      partySocket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
  
        if (message.type === 'update') {
          connectionCount = message.count;
        }
      });
      
      const render = (now: number) => {
        now *= 0.001;
        const deltaTime = now - lastTime;
        lastTime = now;
        const computedRadius = connectionCount * scaleFactor;

        center.x += velocity.x * deltaTime;
        center.y += velocity.y * deltaTime;

        if (center.x - computedRadius < 0 && velocity.x < 0) {
          center.x = computedRadius;
          velocity.x *= -1;
        }
        if (center.x + computedRadius > 1 && velocity.x > 0) {
          center.x = 1 - computedRadius;
          velocity.x *= -1;
        }
        if (center.y - computedRadius < 0 && velocity.y < 0) {
          center.y = computedRadius;
          velocity.y *= -1;
        }
        if (center.y + computedRadius > 1 && velocity.y > 0) {
          center.y = 1 - computedRadius;
          velocity.y *= -1;
        }

        this.gl?.uniform2f(uCenterLocation, center.x, center.y);
        this.gl?.uniform1f(uRadiusLocation, computedRadius);

        this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl?.clearColor(0, 0, 0, 1);
        this.gl?.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl?.drawArrays(this.gl.TRIANGLES, 0, 6);

        requestAnimationFrame(render);
      }

      requestAnimationFrame(render);
    }
  }
}

document.body.appendChild(document.createElement('my-app'));