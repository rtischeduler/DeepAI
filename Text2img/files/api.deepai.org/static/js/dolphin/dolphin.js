import * as THREE from 'three';
import { RAW_POS, RAW_NORM, SEG_IDS, INIT_Y } from './dolphin-model.js';

const RRAD = 0.01745;
const VERT_COUNT = RAW_POS.length / 3;
const TRI_COUNT = VERT_COUNT / 3;

const SEG_PARAMS = {
    1: [1.0, 0], 2: [2.0, 4], 3: [3.0, 6], 4: [1.0, 0],
    5: [4.0, 10], 6: [4.5, 15], 7: [5.0, 20], 8: [6.0, 30], 9: [0, 0],
};

// Precompute per-vertex normalized body position for lateral bending (0 = nose, 1 = tail)
let minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < VERT_COUNT; i++) {
    const z = RAW_POS[i * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
}
const zRange = maxZ - minZ || 1;
const BODY_T = new Float32Array(VERT_COUNT);
for (let i = 0; i < VERT_COUNT; i++) {
    BODY_T[i] = (maxZ - RAW_POS[i * 3 + 2]) / zRange;
}

/**
 * Creates an Atlantis dolphin mesh with smooth normals and swimming animation.
 * Returns a group containing the mesh and a glow light, plus an update function.
 */
export function createDolphin() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(RAW_POS);
    const normals = new Float32Array(RAW_NORM);

    // Countershading vertex colors
    const colors = new Float32Array(VERT_COUNT * 3);
    const topCol = new THREE.Color(0x3a7aa8);
    const bellyCol = new THREE.Color(0xc8dde8);
    for (let i = 0; i < VERT_COUNT; i++) {
        const y = positions[i * 3 + 1];
        const blend = THREE.MathUtils.smoothstep(y + 0.15, -0.2, 0.2);
        const c = bellyCol.clone().lerp(topCol, blend);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }

    // Smooth normals with double-sided face awareness
    const origPositions = new Float32Array(RAW_POS);
    const posKey = i => origPositions[i*3].toFixed(2)+','+origPositions[i*3+1].toFixed(2)+','+origPositions[i*3+2].toFixed(2);
    const posMap = new Map();
    for (let i = 0; i < VERT_COUNT; i++) {
        const k = posKey(i);
        if (!posMap.has(k)) posMap.set(k, []);
        posMap.get(k).push(i);
    }

    const initFaceNormals = new Float32Array(TRI_COUNT * 3);
    for (let t = 0; t < TRI_COUNT; t++) {
        const i = t * 3;
        const e1x = positions[(i+1)*3]-positions[i*3], e1y = positions[(i+1)*3+1]-positions[i*3+1], e1z = positions[(i+1)*3+2]-positions[i*3+2];
        const e2x = positions[(i+2)*3]-positions[i*3], e2y = positions[(i+2)*3+1]-positions[i*3+1], e2z = positions[(i+2)*3+2]-positions[i*3+2];
        const nx = e1y*e2z-e1z*e2y, ny = e1z*e2x-e1x*e2z, nz = e1x*e2y-e1y*e2x;
        const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
        initFaceNormals[t*3] = nx/len; initFaceNormals[t*3+1] = ny/len; initFaceNormals[t*3+2] = nz/len;
    }

    const compatNeighbors = new Array(VERT_COUNT);
    for (let i = 0; i < VERT_COUNT; i++) {
        const myTri = Math.floor(i / 3);
        const mfx = initFaceNormals[myTri*3], mfy = initFaceNormals[myTri*3+1], mfz = initFaceNormals[myTri*3+2];
        const neighbors = [];
        for (const si of posMap.get(posKey(i))) {
            const siTri = Math.floor(si / 3);
            const sfx = initFaceNormals[siTri*3], sfy = initFaceNormals[siTri*3+1], sfz = initFaceNormals[siTri*3+2];
            if (mfx*sfx + mfy*sfy + mfz*sfz > 0) neighbors.push(si);
        }
        compatNeighbors[i] = neighbors;
    }

    function computeSmoothNormals(posArr, normArr) {
        const fn = new Float32Array(TRI_COUNT * 3);
        for (let t = 0; t < TRI_COUNT; t++) {
            const i = t * 3;
            const e1x = posArr[(i+1)*3]-posArr[i*3], e1y = posArr[(i+1)*3+1]-posArr[i*3+1], e1z = posArr[(i+1)*3+2]-posArr[i*3+2];
            const e2x = posArr[(i+2)*3]-posArr[i*3], e2y = posArr[(i+2)*3+1]-posArr[i*3+1], e2z = posArr[(i+2)*3+2]-posArr[i*3+2];
            fn[t*3] = e1y*e2z-e1z*e2y; fn[t*3+1] = e1z*e2x-e1x*e2z; fn[t*3+2] = e1x*e2y-e1y*e2x;
        }
        for (let i = 0; i < VERT_COUNT; i++) {
            let nx = 0, ny = 0, nz = 0;
            for (const si of compatNeighbors[i]) {
                const tri = Math.floor(si / 3);
                nx += fn[tri*3]; ny += fn[tri*3+1]; nz += fn[tri*3+2];
            }
            const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
            normArr[i*3] = nx/len; normArr[i*3+1] = ny/len; normArr[i*3+2] = nz/len;
        }
    }

    computeSmoothNormals(positions, normals);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true, metalness: 0.05, roughness: 0.25,
        clearcoat: 1.0, clearcoatRoughness: 0.06, side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    group.add(new THREE.PointLight(0x00aaff, 0.5, 5));

    // Animation state
    let htail = 0;
    let smoothedYaw = 0;
    const BEND_RESPONSE = 3.5;
    const BEND_SCALE = 0.5;
    const posAttr = geo.attributes.position;

    function animate(speed, dt, yawError = 0) {
        smoothedYaw += (yawError - smoothedYaw) * Math.min(BEND_RESPONSE * dt, 1.0);

        const bendAngle = smoothedYaw * BEND_SCALE;

        const swimAnimSpeed = 0.3 + Math.min(speed * 0.8, 2.5);
        htail = (htail - 7.0 * swimAnimSpeed * dt * 60) % 360;
        const thrash = 55.0 * swimAnimSpeed * 0.00021;

        for (let i = 0; i < VERT_COUNT; i++) {
            const origX = RAW_POS[i * 3];
            const origZ = RAW_POS[i * 3 + 2];

            const angle = bendAngle * BODY_T[i];
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const dz = origZ - maxZ;
            posAttr.setX(i, origX * cosA - dz * sinA);
            posAttr.setZ(i, origX * sinA + dz * cosA + maxZ);

            const segId = SEG_IDS[i];
            if (segId === 0) continue;
            const params = SEG_PARAMS[segId];
            if (!params) continue;
            const [ampMult, phaseOff] = params;
            if (segId === 9) {
                posAttr.setY(i, INIT_Y[i] + 100 * 0.00021);
            } else {
                posAttr.setY(i, INIT_Y[i] + ampMult * thrash * Math.sin((htail + phaseOff) * RRAD));
            }
        }
        posAttr.needsUpdate = true;
        computeSmoothNormals(posAttr.array, geo.attributes.normal.array);
        geo.attributes.normal.needsUpdate = true;
    }

    return { group, animate };
}
