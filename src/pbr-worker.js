// Generates PBR texture sets off the main thread.
import { GENERATORS } from './pbr-gen.js';

self.onmessage = ({ data }) => {
  const r = GENERATORS[data.name]();
  self.postMessage({ name: data.name, ...r }, [r.albedo.buffer, r.normal.buffer, r.orm.buffer]);
};
