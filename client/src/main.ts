import './style.css';
import PartySocket from 'partysocket';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const partySocket = new PartySocket({
  host: 'localhost:1999',
  room: 'my-room'
});

interface Circle {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  id: string;
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;

  const device = await adapter.requestDevice();
  if (!device) return null;

  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque'
  });

  const quadVertices = new Float32Array([
    -1.0, -1.0,
    1.0, -1.0,
    -1.0, 1.0,
    -1.0, 1.0,
    1.0, -1.0,
    1.0, 1.0
  ]);

  const vertexBuffer = device.createBuffer({
    size: quadVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });

  new Float32Array(vertexBuffer.getMappedRange()).set(quadVertices);
  vertexBuffer.unmap();

  let circles: Circle[] = [];

  partySocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    console.log(message)

    if (message.kind === 'state') {
      if (!message.circles.length) {
        circles = [];
      }

      circles.push(...message.circles);
    }
    
    if (message.kind === 'spawn') {
      circles.push(message.circle);
    }

    if (message.kind === 'despawn') {
      circles = circles.filter(circle => circle.id !== message.circle.id);
    }

    if (message.kind === 'update') {
      const index = circles.findIndex(circle => circle.id === message.circle.id);
      circles[index] = message.circle;
    }
  });

  const getInstanceData = (): Float32Array => {
    const data = new Float32Array(circles.length * 3);
    circles.forEach((circle, i) => {
      data[i * 3] = circle.x;
      data[i * 3 + 1] = circle.y;
      data[i * 3 + 2] = circle.radius;
    });
    
    return data;
  }
  
  let instanceData = getInstanceData();
  let instanceBufferSize = instanceData.byteLength;
  let instanceBuffer = device.createBuffer({
    size: instanceBufferSize,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const updateInstanceBuffer = () => {
    const newInstanceData = getInstanceData();
    if (newInstanceData.byteLength > instanceBufferSize) {
      instanceBuffer.destroy();
      instanceBufferSize = newInstanceData.byteLength;
      instanceBuffer = device.createBuffer({
        size: instanceBufferSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    device.queue.writeBuffer(instanceBuffer, 0, newInstanceData.buffer, newInstanceData.byteOffset, newInstanceData.byteLength);
  }

  const uniformBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shaderCode = /*WGSL*/`
    @group(0) @binding(0)
    var<uniform> uAspect: f32;

    struct Vout {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
    }

    @vertex
    fn vs(
      @location(0) position: vec2f,
      @location(1) instancePos: vec2f,
      @location(2) radius: f32,
    ) -> Vout {
      var out: Vout;
      let pos = vec2f(position.x / uAspect, position.y);

      out.pos = vec4f(pos * radius + instancePos, 0.0, 1.0);
      out.local = position;

      return out;
    }

    @fragment
    fn fs(
      @location(0) local: vec2f
    ) -> @location(0) vec4f {
      if (length(local) > 1.0) {
        return vec4f(0.0, 0.0, 0.0, 0.0);
      }

      return vec4f(0.0, 0.5, 1.0, 0.3);
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });
  const vertexBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: 2 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' }
      ],
    },
    {
      arrayStride: 3 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 1, offset: 0, format: 'float32x2' },
        { shaderLocation: 2, offset: 8, format: 'float32' },
      ],
    },
  ];

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs',
      buffers: vertexBuffers
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [
        {
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'zero',
              operation: 'add',
            }
          }
        }
      ]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer }
      }
    ]
  });

  const updateCircles = () => {
    circles.forEach(circle => {
      circle.x += circle.vx;
      circle.y += circle.vy;

      if (circle.x + circle.radius > 1 || circle.x - circle.radius < -1) {
        circle.vx = -circle.vx;
      }
      
      if (circle.y + circle.radius > 1 || circle.y - circle.radius < -1) {
        circle.vy = -circle.vy;
      }
    });

    updateInstanceBuffer();
  }

  const render = () => {
    updateCircles();

    const aspect = canvas.width / canvas.height;
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([aspect]));

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.3, g: 0.3, b: 0.3, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setBindGroup(0, bindGroup);
    renderPass.setPipeline(pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setVertexBuffer(1, instanceBuffer);
    renderPass.draw(6, circles.length);
    renderPass.end();

    const commandBuffer = commandEncoder.finish();

    device.queue.submit([commandBuffer]);

    requestAnimationFrame(render);
  };

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
  });

  observer.observe(canvas);

  render();
}

main();