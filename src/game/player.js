import * as THREE from 'three'
import { clamp, lerp } from './rng.js'

const TAU = Math.PI * 2

function wrapAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI
}

function damp(current, target, speed, dt) {
  return lerp(current, target, 1 - Math.exp(-speed * dt))
}

function dampAngle(current, target, speed, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-speed * dt))
}

export class RabbitPlayer {
  constructor({ rabbit, world, scene, onEvent = () => {} }) {
    this.world = world
    this.rabbit = rabbit
    this.onEvent = onEvent
    this.nodes = rabbit.nodes

    this.rig = new THREE.Group()
    this.rig.name = 'RabbitRig'
    this.rig.rotation.order = 'YXZ'
    this.rig.add(rabbit.scene)
    scene.add(this.rig)

    this.position = new THREE.Vector3(3.1, 0, 6)
    this.position.y = world.terrainHeight(this.position.x, this.position.z)
    this.velocity = new THREE.Vector3()
    this.heading = Math.PI
    this.airY = 0
    this.vy = 0
    this.grounded = true
    this.gait = 0
    this.speedNorm = 0
    this.squash = 0
    this.stretch = 0
    this.sniffTimer = 0
    this.blinkTimer = 2.5
    this.blinkPhase = 0
    this.earL = { x: 0, z: 0 }
    this.earR = { x: 0, z: 0 }
    this.headYaw = 0
    this.waterTimer = 0
    this.rippleTimer = 0
    this.time = 0
    this.hopCooldown = 0
    this.landCooldown = 0
    this.wasInWater = false
    this.idleTime = 0

    const n = this.nodes
    this.eyeL = rabbit.scene.getObjectByName('eyeL')
    this.eyeR = rabbit.scene.getObjectByName('eyeR')
    this.shineL = rabbit.scene.getObjectByName('catchlightL')
    this.shineR = rabbit.scene.getObjectByName('catchlightR')
    this.headBase = n.headPivot ? n.headPivot.position.clone() : new THREE.Vector3()
    this.eyeBase = this.eyeL ? this.eyeL.scale.clone() : new THREE.Vector3(1, 1, 1)
  }

  reset() {
    this.position.set(3.1, 0, 6)
    this.position.y = this.world.terrainHeight(this.position.x, this.position.z)
    this.velocity.set(0, 0, 0)
    this.heading = Math.PI
  }

  get inWater() {
    return this.world.isWater(this.position.x, this.position.z)
  }

  hop() {
    if (!this.grounded || this.hopCooldown > 0) return false
    this.vy = 3.25
    this.airY = 0.001
    this.grounded = false
    this.hopCooldown = 0.45
    this.squash = -0.08
    this.onEvent('hop', this.position)
    return true
  }

  sniff() {
    if (this.sniffTimer > 0) return
    this.sniffTimer = 1.7
    this.onEvent('sniff', this.position)
  }

  update(dt, input, cameraYaw) {
    this.time += dt
    this.hopCooldown = Math.max(0, this.hopCooldown - dt)
    this.landCooldown = Math.max(0, this.landCooldown - dt)

    let moveX = input.moveX || 0
    let moveY = input.moveY || 0
    const mag = Math.hypot(moveX, moveY)
    if (mag > 1) {
      moveX /= mag
      moveY /= mag
    }
    const dead = Math.hypot(moveX, moveY) < 0.08
    if (dead) {
      moveX = 0
      moveY = 0
    }

    const fx = -Math.sin(cameraYaw)
    const fz = -Math.cos(cameraYaw)
    const rx = Math.cos(cameraYaw)
    const rz = -Math.sin(cameraYaw)
    const wishX = fx * moveY + rx * moveX
    const wishZ = fz * moveY + rz * moveX

    const inWater = this.inWater
    const topSpeed = (inWater ? 1.15 : 2.35) * (input.run ? 1.15 : 1)
    const accel = this.grounded ? (inWater ? 4.2 : 9) : 3.2
    this.velocity.x = damp(this.velocity.x, wishX * topSpeed, accel, dt)
    this.velocity.z = damp(this.velocity.z, wishZ * topSpeed, accel, dt)
    if (this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0, 0)

    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.speedNorm = damp(this.speedNorm, clamp(speed / 2.35, 0, 1), 8, dt)

    this.position.x += this.velocity.x * dt
    this.position.z += this.velocity.z * dt
    const distance = Math.hypot(this.position.x, this.position.z)
    const limit = this.world.bounds
    if (distance > limit) {
      const k = limit / distance
      this.position.x *= k
      this.position.z *= k
      this.velocity.multiplyScalar(0.4)
    }

    if (speed > 0.2) {
      const targetHeading = Math.atan2(this.velocity.x, this.velocity.z)
      this.heading = dampAngle(this.heading, targetHeading, 9, dt)
      this.idleTime = 0
    } else {
      this.idleTime += dt
    }

    const ground = this.world.terrainHeight(this.position.x, this.position.z)
    this.position.y = ground

    // pounce arc
    if (!this.grounded) {
      this.airY += this.vy * dt
      this.vy -= 9.8 * dt
      if (this.airY <= 0) {
        const impact = -this.vy
        this.airY = 0
        this.vy = 0
        this.grounded = true
        this.squash = clamp(impact * 0.035, 0.06, 0.2)
        this.landCooldown = 0.25
        this.onEvent('land', this.position, impact)
        if (inWater) this.onEvent('splash', this.position)
      }
    }

    this.squash = damp(this.squash, 0, 7, dt)
    this.stretch = damp(this.stretch, this.grounded ? 0 : clamp(this.vy * 0.035, -0.09, 0.12), 8, dt)

    // gait
    const gaitSpeed = this.grounded ? speed * 9.0 : 4.0
    this.gait += gaitSpeed * dt
    const gaitSin = Math.sin(this.gait)
    const bounce = this.grounded ? Math.abs(gaitSin) * 0.038 * this.speedNorm : 0
    const hopCompress = this.grounded ? (1 - Math.abs(gaitSin)) * 0.025 * this.speedNorm : 0

    // water interaction
    if (inWater && speed > 0.15 && this.grounded) {
      this.rippleTimer -= dt
      if (this.rippleTimer <= 0) {
        this.rippleTimer = 0.34
        this.world.ripple(this.position.x + (Math.random() - 0.5) * 0.25, this.position.z + (Math.random() - 0.5) * 0.25, 0.6)
        this.world.puff(this.position.x, this.world.pond.level + 0.05, this.position.z, 0xbfe0d8, 2, 0.25)
      }
    }

    // dust while sprinting on land
    this.waterTimer -= dt
    if (!inWater && this.grounded && speed > 1.5 && this.waterTimer <= 0) {
      this.waterTimer = 0.32
      this.world.puff(this.position.x, ground + 0.04, this.position.z, 0xc9b891, 1, 0.2)
    }

    /* ---------------- rig transform ---------------- */
    const scaleY = 1 - this.squash + this.stretch - hopCompress
    const scaleXZ = 1 + this.squash * 0.55 - this.stretch * 0.45 + hopCompress * 0.5
    this.rig.position.set(this.position.x, ground + this.airY + bounce, this.position.z)
    this.rig.rotation.y = this.heading
    const lean = -this.speedNorm * 0.045 + (this.grounded ? 0 : clamp(-this.vy * 0.02, -0.1, 0.1))
    this.rig.rotation.x = lean
    this.rig.rotation.z = -this.velocity.dot(new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading))) * 0.015
    this.rig.scale.set(scaleXZ, Math.max(0.7, scaleY), scaleXZ)

    /* ---------------- face + ears ---------------- */
    const t = this.time
    const moving = this.speedNorm > 0.12
    let headYawTarget = 0
    if (!moving && this.idleTime > 1.2 && this.cameraPos) {
      const camAngle = Math.atan2(this.cameraPos.x - this.position.x, this.cameraPos.z - this.position.z)
      headYawTarget = clamp(wrapAngle(camAngle - this.heading), -0.5, 0.5)
      headYawTarget *= Math.min(1, this.idleTime / 2.5)
    }
    this.headYaw = damp(this.headYaw, headYawTarget, 3, dt)

    if (this.sniffTimer > 0) this.sniffTimer -= dt
    const sniff = this.sniffTimer > 0 ? Math.sin(Math.min(1, this.sniffTimer / 1.7) * Math.PI) : 0
    const nod = sniff * 0.4 + this.speedNorm * 0.03 + (this.grounded ? 0 : clamp(-this.vy * 0.03, -0.08, 0.12))

    if (this.nodes.headPivot) {
      this.nodes.headPivot.rotation.y = damp(this.nodes.headPivot.rotation.y, this.headYaw, 8, dt)
      this.nodes.headPivot.rotation.x = damp(this.nodes.headPivot.rotation.x, nod, 8, dt)
      this.nodes.headPivot.rotation.z = damp(this.nodes.headPivot.rotation.z, Math.sin(t * 0.9) * 0.012 + (sniff > 0 ? Math.sin(t * 22) * 0.02 * sniff : 0), 7, dt)
      this.nodes.headPivot.position.y = this.headBase.y + Math.sin(t * 1.55) * 0.0035 + sniff * -0.012
      this.nodes.headPivot.position.z = this.headBase.z + sniff * 0.012
    }

    if (this.nodes.earL && this.nodes.earR) {
      const earLag = clamp(-this.vy * 0.055 + (this.grounded ? Math.sin(this.gait + 0.8) * 0.05 * this.speedNorm : 0), -0.3, 0.25)
      const twitch = (Math.sin(t * 0.7) > 0.98 ? Math.sin(t * 30) * 0.05 : 0) + sniff * -0.12
      const flap = Math.sin(t * 1.6 + 1) * 0.015 + this.speedNorm * 0.05
      this.earL.x = damp(this.earL.x, earLag + twitch, 7, dt)
      this.earR.x = damp(this.earR.x, earLag + twitch * 0.8 + 0.02, 7, dt)
      this.earL.z = damp(this.earL.z, flap, 5, dt)
      this.earR.z = damp(this.earR.z, -flap * 0.85, 5, dt)
      this.nodes.earL.rotation.x = -0.1 + this.earL.x
      this.nodes.earR.rotation.x = -0.1 + this.earR.x
      this.nodes.earL.rotation.z = 0.14 + this.earL.z
      this.nodes.earR.rotation.z = -0.14 + this.earR.z
    }

    if (this.nodes.tailPivot) {
      this.nodes.tailPivot.rotation.z = Math.sin(t * 2.2 + this.gait * 0.4) * (0.08 + this.speedNorm * 0.14)
      this.nodes.tailPivot.rotation.x = Math.sin(t * 1.3) * 0.05
    }

    // legs
    const step = Math.sin(this.gait) * 0.34 * this.speedNorm
    const step2 = Math.sin(this.gait + 0.9) * 0.27 * this.speedNorm
    if (this.nodes.legFL) this.nodes.legFL.rotation.x = this.grounded ? step : -0.55
    if (this.nodes.legFR) this.nodes.legFR.rotation.x = this.grounded ? -step : -0.55
    if (this.nodes.legBL) this.nodes.legBL.rotation.x = this.grounded ? -step2 : 0.55
    if (this.nodes.legBR) this.nodes.legBR.rotation.x = this.grounded ? step2 : 0.55

    // blink
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 4.2
      this.blinkPhase = 0.16
    }
    if (this.blinkPhase > 0) this.blinkPhase -= dt
    const blink = this.blinkPhase > 0 ? Math.max(0.08, Math.abs(Math.sin(this.blinkPhase * 20))) : 1
    if (this.eyeL) this.eyeL.scale.y = this.eyeBase.y * (this.blinkPhase > 0 ? blink : 1)
    if (this.eyeR) this.eyeR.scale.y = this.eyeBase.y * (this.blinkPhase > 0 ? blink : 1)
    if (this.shineL) this.shineL.visible = this.blinkPhase <= 0.02
    if (this.shineR) this.shineR.visible = this.blinkPhase <= 0.02

    // nose wiggle
    const nose = this.nodes.headPivot?.getObjectByName('nose')
    if (nose) nose.scale.set(0.013 * (1 + sniff * 0.08), 0.0095 * (1 + sniff * 0.1), 0.008)
  }

  setCameraPosition(pos) {
    this.cameraPos = pos
  }
}
