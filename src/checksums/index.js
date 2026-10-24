// Checksum plugin registry. A plugin is {id, name, fixable, detect, verify,
// coverage, layout, storedAt, fix}; see checksums/ems2k.js for the reference one.
import { ems2k } from './ems2k.js';

export const PLUGINS = [ems2k];

export function pickPlugin(img) {
  const reasons = [];
  for (const plugin of PLUGINS) {
    const d = plugin.detect(img);
    if (d.ok) return { plugin, reasons };
    reasons.push({ name: plugin.name, reason: d.reason });
  }
  return { plugin: null, reasons };
}
