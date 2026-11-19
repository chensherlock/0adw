import * as THREE from 'three';
import { TERRAIN_TEXTURES } from '../config/assets';
import { TerrainMap, WATER_LEVEL } from '../sim/map/TerrainMap';
import { SeededRNG } from '../sim/rng';
import { World } from '../sim/World';

function loadTiledTexture(loader: THREE.TextureLoader, url: string, isSRGB: boolean, repeat = 1): THREE.Texture {
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createGroundDetailTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;

  const rng = new SeededRNG(90210);

  // Neutral-bright base so vertex colors drive biome hues cleanly
  ctx.fillStyle = '#e8eae0';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Soft organic mottling patches (clover, dry soil, dappled shade)
  for (let i = 0; i < 420; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(8, 34);
    const bright = rng.next() > 0.5;
    ctx.fillStyle = bright ? 'rgba(255, 255, 240, 0.08)' : 'rgba(65, 78, 42, 0.09)';
    // Tile-wrap across edges for seamless repeating
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    bctx.fillStyle = bright ? 'rgba(210, 210, 210, 0.12)' : 'rgba(55, 55, 55, 0.12)';
    bctx.beginPath();
    bctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    bctx.fill();
  }

  // Crisp grass-blade strokes & soil grain
  for (let i = 0; i < 4800; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(3, 9);
    const ang = rng.range(-0.6, 0.6) - Math.PI * 0.5;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const shade = rng.next();

    ctx.strokeStyle =
      shade < 0.38
        ? 'rgba(72, 98, 44, 0.24)'
        : shade < 0.74
          ? 'rgba(182, 198, 128, 0.22)'
          : 'rgba(138, 122, 78, 0.2)';
    ctx.lineWidth = rng.range(0.8, 1.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();

    bctx.strokeStyle = shade < 0.5 ? 'rgba(240,240,240,0.28)' : 'rgba(35,35,35,0.22)';
    bctx.lineWidth = 1.2;
    bctx.beginPath();
    bctx.moveTo(x, y);
    bctx.lineTo(x + dx, y + dy);
    bctx.stroke();
  }

  // Tiny soil specks & sunlit pebbles
  for (let i = 0; i < 1200; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.7, 2.0);
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(92, 82, 58, 0.22)' : 'rgba(235, 228, 200, 0.2)';
    ctx.fillRect(x, y, r, r);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(44, 44);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(44, 44);

  return { map, bumpMap };
}

/** Builds a 3D multi-blade grass tuft geometry (4 angled tapered blades per clump) */
function createGrassTuftGeometry(bladeCount = 4, height = 0.52, spread = 0.24): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.35;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = -sin;
    const pz = cos;

    const baseOffset = spread * 0.35;
    const bx = cos * baseOffset;
    const bz = sin * baseOffset;
    const halfW = 0.065;

    const tipX = cos * (spread * 1.15);
    const tipZ = sin * (spread * 1.15);
    const tipY = height * (0.82 + (i % 3) * 0.14);

    // Triangle 1 (base-left, base-right, tip)
    positions.push(
      bx - px * halfW, 0, bz - pz * halfW,
      bx + px * halfW, 0, bz + pz * halfW,
      tipX, tipY, tipZ
    );
    // Point normal slightly upward + outward for rich sunlit shading
    const nx = cos * 0.35;
    const nz = sin * 0.35;
    normals.push(nx, 0.92, nz, nx, 0.92, nz, nx, 0.98, nz);
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geom;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly terrainMesh: THREE.Mesh;
  readonly waterMesh: THREE.Mesh;

  private readonly territoryData: Uint8Array;
  private readonly territoryTex: THREE.DataTexture;
  private readonly fogData: Uint8Array;
  private readonly fogTex: THREE.DataTexture;
  private readonly depthTex: THREE.DataTexture;
  private readonly detailMap: THREE.CanvasTexture;
  private readonly detailBump: THREE.CanvasTexture;
  private readonly grassTex: THREE.Texture;
  private readonly grassNormTex: THREE.Texture;
  private readonly dirtTex: THREE.Texture;
  private readonly cliffTex: THREE.Texture;
  private readonly foliageMeshes: THREE.InstancedMesh[] = [];

  private lastTerritoryVersion = -1;
  private lastFogVersion = -1;
  private revealAll = false;

  private shaderUniforms: {
    uTerritoryTex: { value: THREE.DataTexture };
    uFogTex: { value: THREE.DataTexture };
    uGrassTex: { value: THREE.Texture };
    uDirtTex: { value: THREE.Texture };
    uCliffTex: { value: THREE.Texture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
  };

  private waterUniforms: {
    uTime: { value: number };
    uDepthTex: { value: THREE.DataTexture };
    uFogTex: { value: THREE.DataTexture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
  };

  private foliageUniforms: {
    uTime: { value: number };
    uFogTex: { value: THREE.DataTexture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
  };

  constructor(terrain: TerrainMap) {
    const w = terrain.width;
    const h = terrain.height;

    this.territoryData = new Uint8Array(w * h * 4);
    this.territoryTex = new THREE.DataTexture(this.territoryData, w, h, THREE.RGBAFormat);
    this.territoryTex.magFilter = THREE.LinearFilter;
    this.territoryTex.minFilter = THREE.LinearFilter;
    this.territoryTex.needsUpdate = true;

    this.fogData = new Uint8Array(w * h * 4);
    this.fogData.fill(255);
    this.fogTex = new THREE.DataTexture(this.fogData, w, h, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;

    const detail = createGroundDetailTextures();
    this.detailMap = detail.map;
    this.detailBump = detail.bumpMap;

    const texLoader = new THREE.TextureLoader();
    this.grassTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.grass, true);
    this.grassNormTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.grassNorm, false, 36);
    this.dirtTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.dirt, true);
    this.cliffTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.cliff, true);

    // Bake water depth texture so sea/river/lake/fords have rich turquoise-to-sapphire depth & shore foam
    const depthData = new Uint8Array(w * h * 4);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const y = terrain.getVertexHeight(x, z);
        const depth = Math.max(0, WATER_LEVEL - y);
        const normDepth = Math.min(255, Math.round((depth / 5.0) * 255));
        const isFord = terrain.fordMask[z * w + x] === 1 ? 255 : 0;
        const idx = (z * w + x) * 4;
        depthData[idx] = normDepth;
        depthData[idx + 1] = isFord;
        depthData[idx + 2] = 0;
        depthData[idx + 3] = 255;
      }
    }
    this.depthTex = new THREE.DataTexture(depthData, w, h, THREE.RGBAFormat);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;

    this.shaderUniforms = {
      uTerritoryTex: { value: this.territoryTex },
      uFogTex: { value: this.fogTex },
      uGrassTex: { value: this.grassTex },
      uDirtTex: { value: this.dirtTex },
      uCliffTex: { value: this.cliffTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
    };

    this.foliageUniforms = {
      uTime: { value: 0 },
      uFogTex: { value: this.fogTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
    };

    // Build terrain BufferGeometry
    const geom = new THREE.PlaneGeometry(terrain.worldSize, terrain.worldSize, w, h);
    geom.rotateX(-Math.PI / 2);
    geom.translate(terrain.worldSize * 0.5, 0, terrain.worldSize * 0.5);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();

    const cDeepBed = new THREE.Color(0x1f495c);
    const cShallowBed = new THREE.Color(0xcab683);
    const cSand = new THREE.Color(0xe6cf98);
    const cLushGrass = new THREE.Color(0x5e833d);
    const cMeadow = new THREE.Color(0x7c9748);
    const cDryHill = new THREE.Color(0xa69b56);
    const cDirtPatch = new THREE.Color(0x9e8c63);
    const cFoothillRock = new THREE.Color(0x837b70);
    const cCliffRock = new THREE.Color(0x6c6660);
    const cAlpineStone = new THREE.Color(0xa6a39d);
    const cSnow = new THREE.Color(0xeef2f6);

    const vw = w + 1;
    for (let i = 0; i < pos.count; i++) {
      const vx = i % vw;
      const vz = Math.floor(i / vw);
      const y = terrain.getVertexHeight(vx, vz);
      pos.setY(i, y);

      const hL = terrain.getVertexHeight(vx - 1, vz);
      const hR = terrain.getVertexHeight(vx + 1, vz);
      const hU = terrain.getVertexHeight(vx, vz - 1);
      const hD = terrain.getVertexHeight(vx, vz + 1);
      const slope = Math.hypot(hR - hL, hD - hU) * 0.5;

      const patch1 = Math.sin(vx * 0.21 + vz * 0.13) * Math.cos(vz * 0.19 - vx * 0.09) * 0.5 + 0.5;
      const patch2 = Math.sin(vx * 0.47 - vz * 0.38) * 0.5 + 0.5;
      const tx = Math.min(w - 1, vx);
      const tz = Math.min(h - 1, vz);
      const isFord = terrain.fordMask[tz * w + tx] === 1;

      if (isFord) {
        col.copy(cSand).lerp(cShallowBed, 0.35);
      } else if (y < WATER_LEVEL - 1.2) {
        col.copy(cDeepBed);
      } else if (y < WATER_LEVEL + 0.05) {
        const t = THREE.MathUtils.clamp((y - (WATER_LEVEL - 1.2)) / 1.25, 0, 1);
        col.copy(cDeepBed).lerp(cShallowBed, t);
      } else if (y < WATER_LEVEL + 0.85) {
        const t = THREE.MathUtils.clamp((y - (WATER_LEVEL + 0.05)) / 0.8, 0, 1);
        col.copy(cSand).lerp(cLushGrass, t * t);
      } else if (y < 4.8) {
        const t = THREE.MathUtils.clamp((y - 0.85) / 3.95, 0, 1);
        col.copy(cLushGrass).lerp(cMeadow, patch1 * 0.72).lerp(cDryHill, t * 0.55);
        // Natural warm earth / worn grass patches
        if (patch2 > 0.76) {
          col.lerp(cDirtPatch, (patch2 - 0.76) * 1.4);
        }
      } else if (y < 8.5) {
        const t = THREE.MathUtils.clamp((y - 4.8) / 3.7, 0, 1);
        col.copy(cDryHill).lerp(cFoothillRock, t * 0.85);
      } else if (y < 12.2) {
        const t = THREE.MathUtils.clamp((y - 8.5) / 3.7, 0, 1);
        col.copy(cFoothillRock).lerp(cAlpineStone, t);
      } else {
        const t = THREE.MathUtils.clamp((y - 12.2) / 2.2, 0, 1);
        col.copy(cAlpineStone).lerp(cSnow, t * 0.92);
      }

      // Subtle worn courtyard dirt right under starting Civic Centers
      for (const s of terrain.spawns) {
        const ds = Math.hypot(vx - s.tileX, vz - s.tileZ);
        if (ds < 5.5) {
          col.lerp(cDirtPatch, (1 - ds / 5.5) * 0.55);
        }
      }

      if (slope > 0.6 && y > WATER_LEVEL + 0.3) {
        const rockBlend = THREE.MathUtils.clamp((slope - 0.6) / 1.0, 0, 0.92);
        col.lerp(y > 9.0 ? cAlpineStone : cCliffRock, rockBlend);
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.detailMap,
      normalMap: this.grassNormTex,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughness: 0.91,
      metalness: 0.02,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTerritoryTex = this.shaderUniforms.uTerritoryTex;
      shader.uniforms.uFogTex = this.shaderUniforms.uFogTex;
      shader.uniforms.uGrassTex = this.shaderUniforms.uGrassTex;
      shader.uniforms.uDirtTex = this.shaderUniforms.uDirtTex;
      shader.uniforms.uCliffTex = this.shaderUniforms.uCliffTex;
      shader.uniforms.uWorldSize = this.shaderUniforms.uWorldSize;
      shader.uniforms.uRevealAll = this.shaderUniforms.uRevealAll;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWorldSize;
          varying vec2 vWorldMapUv;
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNorm;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vWorldMapUv = vec2(position.x / uWorldSize, position.z / uWorldSize);
          vTerrainWorldPos = position;
          vTerrainWorldNorm = normalize(normal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uTerritoryTex;
          uniform sampler2D uFogTex;
          uniform sampler2D uGrassTex;
          uniform sampler2D uDirtTex;
          uniform sampler2D uCliffTex;
          uniform float uRevealAll;
          varying vec2 vWorldMapUv;
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNorm;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 tileUv = vTerrainWorldPos.xz * 0.14;
            vec3 grassCol = texture2D(uGrassTex, tileUv).rgb;
            vec3 dirtCol = texture2D(uDirtTex, tileUv * 0.85).rgb;
            vec3 cliffCol = texture2D(uCliffTex, tileUv * 0.65).rgb;

            float slopeFactor = smoothstep(0.10, 0.34, 1.0 - vTerrainWorldNorm.y);
            float dryFactor = smoothstep(2.8, 7.6, vTerrainWorldPos.y);
            float beachMask = smoothstep(-0.2, 0.9, vTerrainWorldPos.y);
            float snowMask = 1.0 - smoothstep(10.8, 13.5, vTerrainWorldPos.y);

            vec3 zeroAdTex = mix(grassCol, dirtCol, dryFactor * 0.72);
            zeroAdTex = mix(zeroAdTex, cliffCol, slopeFactor);

            // Blend authentic 0 A.D. Mediterranean textures while preserving beach sand, riverbeds & alpine peaks
            float splatStrength = beachMask * snowMask * 0.78;
            vec3 tint = mix(vec3(1.0), vColor.rgb * 1.45, 0.42);
            diffuseColor.rgb = mix(diffuseColor.rgb, zeroAdTex * tint, splatStrength);
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `
          vec4 terr = texture2D(uTerritoryTex, vWorldMapUv);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, terr.rgb, terr.a * 0.72);

          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vWorldMapUv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            gl_FragColor.rgb *= visMult;
          }
          #include <dithering_fragment>`
        );
    };

    this.terrainMesh = new THREE.Mesh(geom, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'terrain';
    this.group.add(this.terrainMesh);

    // Populate lush 3D grass tufts, wildflowers, lakeside reeds & ground rocks
    this.buildGroundFoliage(terrain);

    // Animated Mediterranean Sea, River & Lake Water Shader
    this.waterUniforms = {
      uTime: { value: 0 },
      uDepthTex: { value: this.depthTex },
      uFogTex: { value: this.fogTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
    };

    const waterGeom = new THREE.PlaneGeometry(terrain.worldSize + 180, terrain.worldSize + 180, 1, 1);
    waterGeom.rotateX(-Math.PI / 2);
    waterGeom.translate(terrain.worldSize * 0.5, WATER_LEVEL, terrain.worldSize * 0.5);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uDepthTex;
        uniform sampler2D uFogTex;
        uniform float uWorldSize;
        uniform float uRevealAll;
        varying vec3 vWorldPos;

        void main() {
          vec2 uv = vWorldPos.xz / uWorldSize;
          bool inBounds = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;

          float depth = 1.0;
          float isFord = 0.0;
          if (inBounds) {
            vec4 dSample = texture2D(uDepthTex, uv);
            depth = dSample.r;
            isFord = dSample.g;
          }

          float w1 = sin(vWorldPos.x * 0.55 + uTime * 1.9 + sin(vWorldPos.z * 0.28) * 1.4);
          float w2 = cos(vWorldPos.z * 0.62 - uTime * 1.5 + vWorldPos.x * 0.22);
          float wave = (w1 + w2) * 0.5;

          vec3 deepSea = vec3(0.06, 0.27, 0.45);
          vec3 midWater = vec3(0.11, 0.48, 0.63);
          vec3 shallowTurquoise = vec3(0.24, 0.72, 0.76);

          vec3 col = mix(shallowTurquoise, midWater, smoothstep(0.02, 0.32, depth));
          col = mix(col, deepSea, smoothstep(0.32, 0.85, depth));

          float glint = smoothstep(0.68, 0.98, wave) * 0.16;
          col += vec3(0.85, 0.95, 1.0) * glint;

          float foamBand = smoothstep(0.11, 0.015, depth) * (0.55 + 0.45 * sin(depth * 48.0 - uTime * 3.2 + wave * 2.0));
          col = mix(col, vec3(0.92, 0.97, 1.0), foamBand * 0.68);

          float alpha = mix(0.55, 0.92, smoothstep(0.01, 0.35, depth));
          if (isFord > 0.2) {
            alpha *= 0.48;
          }

          if (inBounds && uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, uv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            col *= visMult;
          }

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.waterMesh = new THREE.Mesh(waterGeom, waterMat);
    this.group.add(this.waterMesh);
  }

  private createFoliageMaterial(swayStrength: number, doubleSided = true): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.foliageUniforms.uTime;
      shader.uniforms.uFogTex = this.foliageUniforms.uFogTex;
      shader.uniforms.uWorldSize = this.foliageUniforms.uWorldSize;
      shader.uniforms.uRevealAll = this.foliageUniforms.uRevealAll;
      shader.uniforms.uSway = { value: swayStrength };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uWorldSize;
          uniform float uSway;
          varying vec2 vFoliageMapUv;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 instWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          if (uSway > 0.001) {
            float wind = sin(uTime * 2.1 + instWorld.x * 0.32 + instWorld.z * 0.24) * uSway * max(0.0, position.y);
            transformed.x += wind;
            transformed.z += wind * 0.5;
          }
          vFoliageMapUv = vec2(instWorld.x / uWorldSize, instWorld.z / uWorldSize);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uFogTex;
          uniform float uRevealAll;
          varying vec2 vFoliageMapUv;`
        )
        .replace(
          '#include <dithering_fragment>',
          `
          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vFoliageMapUv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            gl_FragColor.rgb *= visMult;
          }
          #include <dithering_fragment>`
        );
    };

    return mat;
  }

  private buildGroundFoliage(terrain: TerrainMap): void {
    const rng = new SeededRNG(terrain.seed ^ 0x5a3c91);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const grassMatrices: THREE.Matrix4[] = [];
    const grassColors: THREE.Color[] = [];
    const flowerMatrices: THREE.Matrix4[] = [];
    const flowerColors: THREE.Color[] = [];
    const reedMatrices: THREE.Matrix4[] = [];
    const reedColors: THREE.Color[] = [];
    const rockMatrices: THREE.Matrix4[] = [];
    const rockColors: THREE.Color[] = [];

    const grassPalette = [0x4c7c32, 0x5c8b38, 0x6c9842, 0x829f4a, 0x9aa44f, 0x456f2d];
    const flowerPalette = [0xf4c430, 0xe86b4a, 0xd9a7c7, 0xf7e7a1, 0x73994b];
    const reedPalette = [0x467638, 0x5e8842, 0x8c8e45];
    const rockPalette = [0x8b857b, 0xa09b90, 0x726d65];

    const isNearSpawnPad = (wx: number, wz: number): boolean => {
      for (const s of terrain.spawns) {
        const c = terrain.tileToWorldCenter(s.tileX, s.tileZ);
        if (Math.hypot(wx - c.x, wz - c.z) < 7.2) return true;
      }
      return false;
    };

    // 1. Dense Meadow Grass Tufts & Wildflowers across lush valleys & hills
    const grassTarget = 6200;
    for (let i = 0; i < grassTarget * 2 && grassMatrices.length < grassTarget; i++) {
      const wx = rng.range(8, terrain.worldSize - 8);
      const wz = rng.range(8, terrain.worldSize - 8);
      if (isNearSpawnPad(wx, wz)) continue;

      const y = terrain.getHeightAt(wx, wz);
      const { tx, tz } = terrain.worldToTile(wx, wz);
      const slope = terrain.getTileSlope(tx, tz);
      if (y < WATER_LEVEL + 0.65 || y > 6.6 || slope > 0.95) continue;

      // Cluster grass naturally using sine patch density
      const density = Math.sin(wx * 0.09) * Math.cos(wz * 0.09) * 0.5 + 0.5;
      if (rng.next() > 0.35 + density * 0.65) continue;

      dummy.position.set(wx, y - 0.03, wz);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const s = rng.range(0.75, 1.55);
      dummy.scale.set(s, s * rng.range(0.85, 1.35), s);
      dummy.updateMatrix();
      grassMatrices.push(dummy.matrix.clone());

      color.setHex(rng.pick(grassPalette));
      // Drier golden grass higher on hillsides
      if (y > 3.6) color.lerp(new THREE.Color(0xb2a559), 0.38);
      grassColors.push(color.clone());

      // Sprinkle Mediterranean wildflowers & scrub tufts among the grass
      if (flowerMatrices.length < 1200 && rng.next() < 0.19) {
        dummy.position.set(wx + rng.range(-0.4, 0.4), y + 0.14, wz + rng.range(-0.4, 0.4));
        dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
        const fs = rng.range(0.55, 1.15);
        dummy.scale.set(fs, fs * 0.85, fs);
        dummy.updateMatrix();
        flowerMatrices.push(dummy.matrix.clone());
        flowerColors.push(new THREE.Color(rng.pick(flowerPalette)));
      }
    }

    // 2. Lakeside & Riverbank Reeds hugging shorelines (0.02..0.75m elevation)
    for (let i = 0; i < 4200 && reedMatrices.length < 850; i++) {
      const wx = rng.range(10, terrain.worldSize - 10);
      const wz = rng.range(10, terrain.worldSize - 10);
      const y = terrain.getHeightAt(wx, wz);
      if (y < WATER_LEVEL - 0.08 || y > WATER_LEVEL + 0.68) continue;
      const { tx, tz } = terrain.worldToTile(wx, wz);
      if (terrain.fordMask[tz * terrain.width + tx] === 1) continue; // Keep ford crossings unobstructed

      dummy.position.set(wx, y - 0.05, wz);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const s = rng.range(0.95, 1.75);
      dummy.scale.set(s * 0.8, s * 1.45, s * 0.8);
      dummy.updateMatrix();
      reedMatrices.push(dummy.matrix.clone());
      reedColors.push(new THREE.Color(rng.pick(reedPalette)));
    }

    // 3. Scattered Mediterranean Fieldstones & Foothill Pebbles
    for (let i = 0; i < 3600 && rockMatrices.length < 900; i++) {
      const wx = rng.range(8, terrain.worldSize - 8);
      const wz = rng.range(8, terrain.worldSize - 8);
      if (isNearSpawnPad(wx, wz)) continue;
      const y = terrain.getHeightAt(wx, wz);
      if (y < WATER_LEVEL + 0.15 || y > 11.5) continue;
      const { tx, tz } = terrain.worldToTile(wx, wz);
      const slope = terrain.getTileSlope(tx, tz);
      // Prefer hills, mountain bases, and beaches
      if (y > 1.0 && y < 3.4 && slope < 0.45 && rng.next() < 0.72) continue;

      dummy.position.set(wx, y - 0.04, wz);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      const sx = rng.range(0.22, 0.68);
      const sy = sx * rng.range(0.45, 0.85);
      const sz = sx * rng.range(0.7, 1.25);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      rockMatrices.push(dummy.matrix.clone());
      rockColors.push(new THREE.Color(rng.pick(rockPalette)));
    }

    const addInstanced = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      matrices: THREE.Matrix4[],
      colors: THREE.Color[]
    ) => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(geom, mat, matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
        mesh.setColorAt(i, colors[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.foliageMeshes.push(mesh);
    };

    addInstanced(createGrassTuftGeometry(4, 0.54, 0.25), this.createFoliageMaterial(0.18, true), grassMatrices, grassColors);
    addInstanced(new THREE.DodecahedronGeometry(0.18, 0), this.createFoliageMaterial(0.08, false), flowerMatrices, flowerColors);
    addInstanced(createGrassTuftGeometry(5, 0.85, 0.2), this.createFoliageMaterial(0.24, true), reedMatrices, reedColors);
    addInstanced(new THREE.DodecahedronGeometry(0.35, 0), this.createFoliageMaterial(0.0, false), rockMatrices, rockColors);
  }

  setRevealAll(reveal: boolean): void {
    this.revealAll = reveal;
    this.shaderUniforms.uRevealAll.value = reveal ? 1 : 0;
    this.waterUniforms.uRevealAll.value = reveal ? 1 : 0;
    this.foliageUniforms.uRevealAll.value = reveal ? 1 : 0;
  }

  isRevealAll(): boolean {
    return this.revealAll;
  }

  update(world: World, humanPlayerId: number, elapsedSec: number): void {
    this.waterUniforms.uTime.value = elapsedSec;
    this.foliageUniforms.uTime.value = elapsedSec;
    this.waterMesh.position.y = Math.sin(elapsedSec * 1.2) * 0.025;

    if (this.lastTerritoryVersion !== world.territory.version) {
      this.lastTerritoryVersion = world.territory.version;
      this.uploadTerritoryTexture(world);
    }

    if (this.lastFogVersion !== world.fog.version) {
      this.lastFogVersion = world.fog.version;
      this.uploadFogTexture(world, humanPlayerId);
    }
  }

  private uploadTerritoryTexture(world: World): void {
    const owner = world.territory.owner;
    const border = world.territory.border;
    const p1Color = new THREE.Color(world.players.get(1)?.color ?? 0x3b82f6);
    const p2Color = new THREE.Color(world.players.get(2)?.color ?? 0xef4444);

    for (let i = 0; i < owner.length; i++) {
      const o = owner[i];
      const idx = i * 4;
      if (o === 0) {
        this.territoryData[idx] = 0;
        this.territoryData[idx + 1] = 0;
        this.territoryData[idx + 2] = 0;
        this.territoryData[idx + 3] = 0;
      } else {
        const c = o === 1 ? p1Color : p2Color;
        const isBorder = border[i] === 1;
        this.territoryData[idx] = Math.min(255, Math.round(c.r * (isBorder ? 280 : 220)));
        this.territoryData[idx + 1] = Math.min(255, Math.round(c.g * (isBorder ? 280 : 220)));
        this.territoryData[idx + 2] = Math.min(255, Math.round(c.b * (isBorder ? 280 : 220)));
        this.territoryData[idx + 3] = isBorder ? 235 : 22;
      }
    }
    this.territoryTex.needsUpdate = true;
  }

  private uploadFogTexture(world: World, playerId: number): void {
    const grid = world.fog.getGrid(playerId);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const byteVal = v === 2 ? 255 : v === 1 ? 132 : 0;
      const idx = i * 4;
      this.fogData[idx] = byteVal;
      this.fogData[idx + 1] = byteVal;
      this.fogData[idx + 2] = byteVal;
      this.fogData[idx + 3] = 255;
    }
    this.fogTex.needsUpdate = true;
  }

  dispose(): void {
    this.terrainMesh.geometry.dispose();
    (this.terrainMesh.material as THREE.Material).dispose();
    this.waterMesh.geometry.dispose();
    (this.waterMesh.material as THREE.Material).dispose();
    for (const m of this.foliageMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.detailMap.dispose();
    this.detailBump.dispose();
    this.grassTex.dispose();
    this.grassNormTex.dispose();
    this.dirtTex.dispose();
    this.cliffTex.dispose();
    this.territoryTex.dispose();
    this.fogTex.dispose();
    this.depthTex.dispose();
  }
}
