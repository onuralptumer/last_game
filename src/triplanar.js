// Triplanar texturing for MeshStandardMaterial. Projects a PBR set (albedo / normal /
// ORM: R = emissive mask, G = roughness, B = metalness) along the three axes, so any
// geometry gets consistent, unstretched surface detail without UVs.
//
//   space 'world'  — texture fixed in the world (static architecture)
//   space 'object' — texture follows the mesh (enemies, weapons)

import * as THREE from 'three';

export function triplanar(mat, set, opts = {}) {
  const {
    scale = 0.5, // texture repeats per metre (1 / tile size)
    space = 'world',
    normalScale = 1,
    emissive = null, // THREE.Color for the ORM.R emissive mask
    rim = null, // THREE.Color for a fresnel rim glow
    grime = false, // darken surfaces near the ground (world space only)
  } = opts;
  const uniforms = {
    tTriA: { value: set.albedo },
    tTriN: { value: set.normal },
    tTriO: { value: set.orm },
    uTriScale: { value: scale },
    uTriNS: { value: normalScale },
    uTriEm: { value: emissive ? emissive.clone() : new THREE.Color(0, 0, 0) },
    uRim: { value: rim ? rim.clone() : new THREE.Color(0, 0, 0) },
  };
  mat.userData.tri = uniforms;
  const defines = [space === 'world' ? '#define TRI_WORLD' : '', rim ? '#define TRI_RIM' : '', grime ? '#define TRI_GRIME' : ''].join('\n');

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defines}\nvarying vec3 vTriPos; varying vec3 vTriNrm; varying vec3 vTriB0; varying vec3 vTriB1; varying vec3 vTriB2;`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 triP = vec4(transformed, 1.0);
          vec3 triNo = objectNormal;
          #ifdef USE_INSTANCING
            triP = instanceMatrix * triP;
            triNo = mat3(instanceMatrix) * triNo;
          #endif
          #ifdef TRI_WORLD
            triP = modelMatrix * triP;
            triNo = mat3(modelMatrix) * triNo;
            mat3 triB = mat3(viewMatrix);
          #else
            mat3 triB = normalMatrix;
          #endif
          vTriPos = triP.xyz;
          vTriNrm = normalize(triNo);
          vTriB0 = triB[0]; vTriB1 = triB[1]; vTriB2 = triB[2];
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${defines}
        varying vec3 vTriPos; varying vec3 vTriNrm; varying vec3 vTriB0; varying vec3 vTriB1; varying vec3 vTriB2;
        uniform sampler2D tTriA; uniform sampler2D tTriN; uniform sampler2D tTriO;
        uniform float uTriScale; uniform float uTriNS; uniform vec3 uTriEm; uniform vec3 uRim;
        vec3 triWeights(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / max(w.x + w.y + w.z, 1e-5); }
        vec4 triSample(sampler2D t, vec3 p, vec3 w){
          return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 triWt = triWeights(normalize(vTriNrm));
        vec3 triP = vTriPos * uTriScale;
        diffuseColor.rgb *= triSample(tTriA, triP, triWt).rgb;
        #ifdef TRI_GRIME
          diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 2.5, vTriPos.y));
        #endif
        vec4 triORM = triSample(tTriO, triP, triWt);`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= triORM.g;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= triORM.b;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 n = normalize(vTriNrm) * faceDirection;
          vec3 tnX = texture2D(tTriN, triP.zy).xyz * 2.0 - 1.0;
          vec3 tnY = texture2D(tTriN, triP.xz).xyz * 2.0 - 1.0;
          vec3 tnZ = texture2D(tTriN, triP.xy).xyz * 2.0 - 1.0;
          tnX.xy *= uTriNS; tnY.xy *= uTriNS; tnZ.xy *= uTriNS;
          tnX = vec3(tnX.xy + n.zy, abs(tnX.z) * n.x);
          tnY = vec3(tnY.xy + n.xz, abs(tnY.z) * n.y);
          tnZ = vec3(tnZ.xy + n.xy, abs(tnZ.z) * n.z);
          vec3 triN = normalize(tnX.zyx * triWt.x + tnY.xzy * triWt.y + tnZ.xyz * triWt.z);
          vec3 vn = mat3(vTriB0, vTriB1, vTriB2) * triN;
          float l = length(vn);
          if (l > 1e-4) normal = vn / l;
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uTriEm * triORM.r;
        #ifdef TRI_RIM
        { float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += uRim * pow(rimF, 4.0) * 0.85; }
        #endif`
      );
  };
  mat.customProgramCacheKey = () => `tri-${space}-${!!rim}-${grime}`;
  return mat;
}
