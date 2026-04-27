import { useEffect, useRef, useState } from 'react'

export function SignalGateBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [webglReady, setWebglReady] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })

    if (!gl) {
      setWebglReady(false)
      return
    }

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;

      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `

    const fragmentSource = `
      precision highp float;

      varying vec2 v_uv;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec2 u_mouse;
      uniform float u_motion;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;

        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.52;
        }

        return value;
      }

      float softCircle(vec2 p, vec2 center, float radius, float blur) {
        float d = length(p - center);
        return 1.0 - smoothstep(radius, radius + blur, d);
      }

      float ring(vec2 p, vec2 center, float radius, float thickness, float blur) {
        float d = abs(length(p - center) - radius);
        return 1.0 - smoothstep(thickness, thickness + blur, d);
      }

      vec3 screenBlend(vec3 base, vec3 blend) {
        return 1.0 - (1.0 - base) * (1.0 - blend);
      }

      void main() {
        vec2 uv = v_uv;
        vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
        vec2 p = (uv - 0.5) * aspect;

        vec2 mouse = (u_mouse / max(u_resolution, vec2(1.0))) - 0.5;
        mouse.x *= aspect.x;

        float t = u_time * (0.35 + 0.65 * u_motion);

        vec3 base = vec3(0.028, 0.031, 0.043);
        vec3 charcoal = vec3(0.058, 0.065, 0.085);
        vec3 blue = vec3(0.176, 0.296, 0.535);
        vec3 cobalt = vec3(0.310, 0.430, 0.720);
        vec3 pearl = vec3(0.870, 0.850, 0.820);
        vec3 mist = vec3(0.470, 0.530, 0.640);

        float grain = noise(uv * u_resolution.xy * 0.42 + t * 0.2);
        float mistField = fbm(p * vec2(1.55, 2.1) + vec2(0.0, t * 0.08));
        float flow = fbm(p * 2.8 + vec2(t * 0.12, -t * 0.07));

        vec2 glowA = vec2(-0.62 + sin(t * 0.55) * 0.05, -0.02 + cos(t * 0.34) * 0.08);
        vec2 glowB = vec2(0.42 + cos(t * 0.32) * 0.05, -0.16 + sin(t * 0.28) * 0.06);
        vec2 glowC = vec2(0.58 + sin(t * 0.19) * 0.04, 0.24 + cos(t * 0.23) * 0.03);
        vec2 glowD = vec2(-0.14 + cos(t * 0.22) * 0.03, 0.30 + sin(t * 0.21) * 0.02);

        float gA = softCircle(p, glowA, 0.22, 0.65);
        float gB = softCircle(p, glowB, 0.13, 0.42);
        float gC = softCircle(p, glowC, 0.07, 0.34);
        float gD = softCircle(p, glowD, 0.16, 0.48);
        float gMouse = softCircle(p, mouse * vec2(0.65, 0.65), 0.04, 0.24);

        float ringA = ring(p, vec2(-0.66, 0.02), 0.28 + sin(t * 0.25) * 0.015, 0.003, 0.05);
        float ringB = ring(p, vec2(0.40, -0.08), 0.17 + cos(t * 0.28) * 0.012, 0.003, 0.04);
        float ringC = ring(p, vec2(0.54, 0.24), 0.10 + sin(t * 0.22) * 0.008, 0.002, 0.03);

        float verticalBeam = smoothstep(0.38, 0.0, abs(p.x + 0.05)) * smoothstep(1.0, -0.25, p.y);
        float sideBeam = smoothstep(0.22, 0.0, abs(p.x - 0.36)) * smoothstep(0.7, -0.2, p.y);
        float lineNoise = smoothstep(0.72, 1.0, sin((p.y * 7.8 + flow * 2.8 - t * 1.25) * 3.14159) * 0.5 + 0.5);

        vec3 color = base;
        color = mix(color, charcoal, smoothstep(0.0, 0.95, mistField) * 0.26);
        color += blue * gA * 0.16;
        color += cobalt * gB * 0.10;
        color += mist * gC * 0.10;
        color += pearl * gD * 0.026;
        color += cobalt * gMouse * 0.05;
        color += vec3(0.18, 0.28, 0.48) * verticalBeam * 0.10;
        color += vec3(0.20, 0.24, 0.35) * sideBeam * 0.06;
        color += vec3(0.34, 0.46, 0.72) * (ringA + ringB + ringC) * 0.055;
        color += vec3(0.22, 0.30, 0.50) * lineNoise * 0.018;

        float panelAura = softCircle(p, vec2(0.47, -0.02), 0.28, 0.40);
        color = screenBlend(color, vec3(0.06, 0.08, 0.12) * panelAura * 0.7);

        float vignette = smoothstep(1.15, 0.24, length(p * vec2(0.94, 1.08)));
        color *= 0.72 + vignette * 0.35;
        color += (grain - 0.5) * 0.022;

        gl_FragColor = vec4(color, 1.0);
      }
    `

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null

      gl.shaderSource(shader, source)
      gl.compileShader(shader)

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }

      return shader
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()

    if (!vertexShader || !fragmentShader || !program) {
      setWebglReady(false)
      return
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      setWebglReady(false)
      return
    }

    const buffer = gl.createBuffer()

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const mouseLocation = gl.getUniformLocation(program, 'u_mouse')
    const motionLocation = gl.getUniformLocation(program, 'u_motion')

    let animationFrame = 0
    const startTime = performance.now()
    let mouse = { x: 0, y: 0 }
    let targetMouse = { x: 0, y: 0 }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()

      targetMouse = {
        x: event.clientX - rect.left,
        y: rect.height - (event.clientY - rect.top),
      }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const render = () => {
      resize()

      const elapsed = (performance.now() - startTime) * 0.001

      mouse.x += (targetMouse.x - mouse.x) * 0.05
      mouse.y += (targetMouse.y - mouse.y) * 0.05

      gl.useProgram(program)
      gl.enableVertexAttribArray(positionLocation)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
      gl.uniform1f(timeLocation, elapsed)
      gl.uniform2f(mouseLocation, mouse.x, mouse.y)
      gl.uniform1f(motionLocation, prefersReducedMotion ? 0.12 : 1.0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('pointermove', handlePointerMove)

      if (buffer) gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="sg-canvas" aria-hidden="true" />
      <div className={`sg-fallback${webglReady ? '' : ' is-visible'}`} />
      <div className="sg-shade" />
      <div className="sg-top-line" />
      <div className="sg-ambient-lines" />
      <div className="sg-grain" />
    </>
  )
}
