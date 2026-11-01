import * as THREE from 'three';

/**
 * Vehicle physics for a swimming dolphin.
 *
 * Coordinate conventions (verified from static renders):
 *   Model: nose=+Z, dorsal=+Y, right=+X
 *   World: +X=screen right, +Y=screen up, +Z=toward camera
 *   Initial orientation R_Y(+PI/2): nose→+X, dorsal→+Y, right→-Z
 *
 * Steering (local space via quaternion.multiply):
 *   R_Y(+angle): yaw nose toward camera (right turn from fish POV)
 *   R_X(-angle): pitch nose up
 */

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Vehicle {
    constructor(opts = {}) {
        this.pos = new THREE.Vector3();
        this.vel = new THREE.Vector3();
        this.orient = new THREE.Quaternion();

        // R_Y(+PI/2): verified correct initial orientation
        this.orient.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

        // Tuning parameters with defaults
        this.thrust      = opts.thrust      ?? 8.0;
        this.fwdDrag     = opts.fwdDrag     ?? 2.0;
        this.sideDrag    = opts.sideDrag    ?? 8.0;
        this.upDrag      = opts.upDrag      ?? 4.0;
        this.yawRate     = opts.yawRate     ?? 3.0;
        this.pitchRate   = opts.pitchRate   ?? 2.0;
        this.levelSpring = opts.levelSpring ?? 4.0;
        this.bankFactor  = opts.bankFactor  ?? 0.4;
        this.minThrust   = opts.minThrust   ?? 0.1;
    }

    reset() {
        this.pos.set(0, 0, 0);
        this.vel.set(0, 0, 0);
        this.orient.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    }

    /**
     * Update the vehicle toward a target position.
     * @param {THREE.Vector3} targetPos - world-space target
     * @param {number} dt - delta time in seconds
     * @returns {{ dist: number, yawError: number, speed: number }}
     */
    update(targetPos, dt) {
        // Local axes from current orientation
        _fwd.set(0, 0, 1).applyQuaternion(this.orient);
        _up.set(0, 1, 0).applyQuaternion(this.orient);
        _right.set(1, 0, 0).applyQuaternion(this.orient);

        // Direction to target
        _toTarget.copy(targetPos).sub(this.pos);
        const dist = _toTarget.length();
        if (dist > 0.01) _toTarget.normalize();

        // Project into local frame
        const localX = _toTarget.dot(_right);
        const localY = _toTarget.dot(_up);
        const localZ = _toTarget.dot(_fwd);

        // ── Yaw: R_Y(+) turns nose toward camera ──
        const yawError = Math.atan2(localX, Math.max(localZ, 0.05));
        const yawAngle = THREE.MathUtils.clamp(yawError * this.yawRate, -4.0, 4.0) * dt;
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);
        this.orient.multiply(_q);

        // ── Pitch: R_X(-) pitches nose up ──
        const pitchError = Math.atan2(localY, Math.max(Math.abs(localZ) + Math.abs(localX), 0.05));
        const pitchAngle = THREE.MathUtils.clamp(pitchError * this.pitchRate, -3.0, 3.0) * dt;
        _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitchAngle);
        this.orient.multiply(_q);

        // ── Leveling spring with bicycle lean ──
        _fwd.set(0, 0, 1).applyQuaternion(this.orient);
        _up.set(0, 1, 0).applyQuaternion(this.orient);

        const desiredUp = new THREE.Vector3(0, 1, 0);
        desiredUp.addScaledVector(_fwd, -desiredUp.dot(_fwd));

        if (desiredUp.lengthSq() > 0.001) {
            desiredUp.normalize();

            // Bank into turns
            const bankAngle = THREE.MathUtils.clamp(yawError * this.bankFactor, -0.5, 0.5);
            const bankQ = new THREE.Quaternion().setFromAxisAngle(_fwd, -bankAngle);
            desiredUp.applyQuaternion(bankQ);
            desiredUp.normalize();

            const cross = _up.clone().cross(desiredUp);
            const rollError = Math.atan2(cross.dot(_fwd), _up.dot(desiredUp));
            const roll = rollError * this.levelSpring * dt;
            _q.setFromAxisAngle(_fwd, roll);
            this.orient.premultiply(_q);
        }

        this.orient.normalize();

        // ── Thrust & anisotropic drag ──
        _fwd.set(0, 0, 1).applyQuaternion(this.orient);
        _up.set(0, 1, 0).applyQuaternion(this.orient);
        _right.set(1, 0, 0).applyQuaternion(this.orient);

        const thrustMag = THREE.MathUtils.clamp(dist * this.thrust, this.minThrust, this.thrust);
        this.vel.add(_fwd.clone().multiplyScalar(thrustMag * dt));

        const fwdSpeed = this.vel.dot(_fwd);
        const sideSpeed = this.vel.dot(_right);
        const upSpeed = this.vel.dot(_up);

        this.vel.set(0, 0, 0);
        this.vel.add(_fwd.clone().multiplyScalar(fwdSpeed * Math.exp(-this.fwdDrag * dt)));
        this.vel.add(_right.clone().multiplyScalar(sideSpeed * Math.exp(-this.sideDrag * dt)));
        this.vel.add(_up.clone().multiplyScalar(upSpeed * Math.exp(-this.upDrag * dt)));

        // Update position
        this.pos.add(this.vel.clone().multiplyScalar(dt));

        return {
            dist,
            yawError,
            speed: this.vel.length(),
        };
    }

    /**
     * Apply the vehicle's position and orientation to a Three.js Object3D.
     * @param {THREE.Object3D} obj
     */
    applyTo(obj) {
        obj.position.copy(this.pos);
        obj.quaternion.copy(this.orient);
    }

    /** Current forward direction in world space */
    getForward() {
        return new THREE.Vector3(0, 0, 1).applyQuaternion(this.orient);
    }

    /** Current up direction in world space */
    getUp() {
        return new THREE.Vector3(0, 1, 0).applyQuaternion(this.orient);
    }

    /** Current right direction in world space */
    getRight() {
        return new THREE.Vector3(1, 0, 0).applyQuaternion(this.orient);
    }
}
