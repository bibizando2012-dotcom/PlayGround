import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FurCoat } from './fur.js'

const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export class Hare {
  constructor(scene, renderer, quality = 1) {
    this.scene = scene
    this.renderer = renderer
    this.quality = quality
    this.group = new THREE.Group()
    this.group.name = 'Hare'
    this.group.position.set(0, 0, 0.4)
    this.heading = 0
    this.group.rotation.y = this.heading
    this.velocity = new THREE.Vector3()
    this.jumpHeight = 0
    this.verticalVelocity = 0
    this.grounded = true
    this.speed = 0
    this.moveAmount = 0
    this.turnRate = 0
    this.petTimer = 0
    this.petCooldown = 0
    this.idleTime = 0
    this.blinkTimer = 2.5
    this.earTwitchTimer = 3
    this.noseTimer = 1
    this.landSquash = 0
    this.parts = {}
    this.model = null
    this.fur = null
    this.ready = false
    this.baseEar = {}
  }

  async load(loader = new GLTFLoader(), url = '/models/hare.glb') {
    const gltf = await loader.loadAsync(url)
    this.model = gltf.scene
    this.model.name = 'HareGLB'
    this.model.position.y = -0.055
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false
        o.receiveShadow = false
        o.frustumCulled = false
        if (o.material) o.material.envMapIntensity = 0.8
      }
    })
    this.group.add(this.model)

    this.fur = new FurCoat(this.renderer, this.quality)
    this.fur.attach(this.model, { maxShells: 1 })

    const get = (name) => this.model.getObjectByName(name)
    const keys = [
      'BodyPivot', 'HeadPivot', 'EarLPivot', 'EarRPivot', 'FootLPivot', 'FootRPivot',
      'FrontLegLPivot', 'FrontLegRPivot', 'TailPivot', 'Nose', 'EyeL', 'EyeR', 'IrisL', 'IrisR',
      'PupilL', 'PupilR', 'GlintL', 'GlintR', 'InnerEarL', 'InnerEarR', 'Fur_Torso',
    ]
    for (const key of keys) this.parts[key] = get(key)
    for (const side of ['L', 'R']) {
      const ear = this.parts[`Ear${side}Pivot`]
      if (ear) this.baseEar[side] = ear.rotation.clone()
    }
    this.baseHead = this.parts.HeadPivot?.rotation.clone()
    this.baseBody = this.parts.BodyPivot?.rotation.clone()
    this.baseNose = this.parts.Nose?.scale.clone()
    if (this.parts.BodyPivot) this.bodyBaseY = this.parts.BodyPivot.position.y

    this.scene.add(this.group)
    this.ready = true
    return this
  }

  get position() {
    return this.group.position
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion)
  }

  jump() {
    if (!this.grounded || this.petTimer > 0) return false
    this.verticalVelocity = 4.65
    this.grounded = false
    this.jumpHeight = 0.001
    return true
  }

  pet() {
    if (this.petCooldown > 0) return false
    this.petTimer = 1.65
    this.petCooldown = 2
    return true
  }

  update(dt, time, input) {
    if (!this.ready) return
    this.petTimer = Math.max(0, this.petTimer - dt)
    this.petCooldown = Math.max(0, this.petCooldown - dt)
    this.landSquash = THREE.MathUtils.damp(this.landSquash, 0, 12, dt)
    if (input) {
      this.moveAmount = THREE.MathUtils.damp(this.moveAmount, input.moveAmount || 0, 7, dt)
      this.speed = THREE.MathUtils.damp(this.speed, input.speed || 0, 8, dt)
      if (input.heading !== undefined) {
        const target = input.heading
        const before = this.heading
        this.heading = lerpAngle(this.heading, target, 1 - Math.exp(-10 * dt))
        let diff = this.heading - before
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        this.turnRate = THREE.MathUtils.damp(this.turnRate, THREE.MathUtils.clamp(diff / Math.max(dt, 0.001) * 0.13, -0.5, 0.5), 8, dt)
        this.group.rotation.y = this.heading
      }
    }

    // Vertical motion.
    if (!this.grounded) {
      this.verticalVelocity -= 12.5 * dt
      this.jumpHeight += this.verticalVelocity * dt
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0
        this.verticalVelocity = 0
        this.grounded = true
        this.landSquash = 1
      }
    }
    this.group.position.y = this.jumpHeight

    const moving = this.speed > 0.08 && this.moveAmount > 0.02
    if (moving) this.idleTime = 0
    else this.idleTime += dt

    const gaitSpeed = 5.2 + this.speed * 2.4
    const gait = time * gaitSpeed
    const move = this.moveAmount
    const inAir = !this.grounded
    const pet = this.petTimer > 0 ? Math.sin((1.65 - this.petTimer) * 3.3) * Math.min(1, this.petTimer * 2) : 0

    const body = this.parts.BodyPivot
    const head = this.parts.HeadPivot
    const tail = this.parts.TailPivot
    if (body) {
      const breathe = Math.sin(time * 1.55) * 0.004 * (1 - move * 0.6)
      const runBob = moving && !inAir ? Math.abs(Math.sin(gait)) * 0.055 * move : 0
      body.position.y = this.bodyBaseY + breathe + runBob - this.landSquash * 0.035
      body.rotation.x = (this.baseBody?.x || 0) + (moving ? -0.035 - Math.sin(gait * 0.5) * 0.025 * move : Math.sin(time * 0.8) * 0.005) + (inAir ? -0.1 : 0) + pet * 0.04
      body.rotation.z = this.turnRate * 0.24 + Math.sin(gait) * 0.018 * move
      body.scale.set(
        1 + this.landSquash * 0.03,
        1 - this.landSquash * 0.07 + breathe * 0.3,
        1 + this.landSquash * 0.02,
      )
    }

    if (head) {
      const idleLook = this.idleTime > 2.4 ? Math.sin(time * 0.36) * 0.22 + Math.sin(time * 0.11) * 0.08 : 0
      const runNod = moving ? Math.sin(gait * 0.5) * 0.045 * move : 0
      head.rotation.x = (this.baseHead?.x || 0) + runNod + (inAir ? 0.06 : 0) - pet * 0.14
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, (moving ? 0 : idleLook) + pet * 0.18, 3, dt)
      head.rotation.z = 0.02 + Math.sin(time * 0.7) * 0.012 + pet * 0.16
    }

    // Ears: upright and alive, laying back in a run or when petted.
    this.earTwitchTimer -= dt
    let twitch = 0
    if (this.earTwitchTimer < 0) {
      twitch = Math.sin(time * 34) * Math.exp(-(this.earTwitchTimer + 0.9) * 4) * 0.22
      if (this.earTwitchTimer < -1.1) this.earTwitchTimer = 3 + Math.random() * 7
    }
    for (const side of ['L', 'R']) {
      const ear = this.parts[`Ear${side}Pivot`]
      if (!ear) continue
      const base = this.baseEar[side]
      const s = side === 'L' ? 1 : -1
      const sideTwitch = s === 1 ? twitch : twitch * 0.6
      const swept = (moving ? 0.28 : 0) + (inAir ? 0.36 : 0) + pet * 0.5
      ear.rotation.x = base.x + swept - Math.sin(gait * 0.5) * 0.06 * move + sideTwitch * 0.7
      ear.rotation.z = base.z + Math.sin(time * 1.35 + (s > 0 ? 0 : 1.2)) * 0.018 + s * (moving ? 0.055 : 0) + sideTwitch
      ear.rotation.y = base.y + Math.sin(time * 0.41 + s) * 0.06 * (1 - move) + pet * s * -0.08
    }

    // Feet and front paws.
    for (const side of ['L', 'R']) {
      const foot = this.parts[`Foot${side}Pivot`]
      const leg = this.parts[`FrontLeg${side}Pivot`]
      const s = side === 'L' ? 1 : -1
      if (foot) {
        const phase = gait + (s > 0 ? 0 : Math.PI)
        const swing = moving && !inAir ? Math.sin(phase) * 0.45 : 0
        foot.rotation.x = -0.04 + swing * move + (inAir ? -0.55 : 0) + this.landSquash * 0.14
        foot.rotation.z = s * (0.02 + (inAir ? 0.12 : 0))
        foot.position.z = -0.036 - swing * 0.04 * move
      }
      if (leg) {
        const phase = gait + (s > 0 ? Math.PI : 0)
        leg.rotation.x = 0.12 + (moving && !inAir ? Math.sin(phase + 0.5) * 0.22 * move : 0) + (inAir ? 0.5 : 0)
      }
    }

    if (tail) {
      tail.rotation.x = Math.sin(time * 1.7) * 0.06 + (moving ? Math.sin(gait) * 0.08 : 0)
      tail.rotation.z = Math.sin(time * 2.1 + 0.5) * 0.08 + this.turnRate * 0.35
      tail.scale.setScalar(1 + Math.sin(time * 2.4) * 0.02)
    }

    // Blink and nose twitch.
    this.blinkTimer -= dt
    let blink = 1
    if (this.blinkTimer < 0) {
      const p = 1 - Math.abs(this.blinkTimer + 0.09) / 0.09
      blink = 0.12 + 0.88 * Math.max(0, Math.abs(1 - p * 2))
      if (this.blinkTimer < -0.2) this.blinkTimer = 2.4 + Math.random() * 4
    }
    for (const side of ['L', 'R']) {
      for (const key of [`Eye${side}`, `Iris${side}`, `Pupil${side}`, `Glint${side}`]) {
        const o = this.parts[key]
        if (!o) continue
        const baseScale = key.startsWith('Glint') ? 1 : 1
        if (!o.userData.baseScale) o.userData.baseScale = o.scale.clone()
        o.scale.y = o.userData.baseScale.y * blink * baseScale
      }
    }
    this.noseTimer -= dt
    if (this.noseTimer < 0) this.noseTimer = 0.35 + Math.random() * 1.1
    if (this.parts.Nose && this.baseNose) {
      const twitchN = Math.sin(time * 28) * 0.12 * Math.max(0, 1 - this.noseTimer * 3)
      this.parts.Nose.scale.set(this.baseNose.x * (1 + twitchN), this.baseNose.y * (1 - twitchN * 0.4), this.baseNose.z)
    }

    this.fur?.update(dt, time, 1)
  }

  dispose() {
    this.scene.remove(this.group)
    this.fur?.dispose?.()
  }
}
