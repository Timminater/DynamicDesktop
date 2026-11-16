'use strict';

// Keep model positions stable. Saved selections use one bit per model.
const kelpModels = [
  { id: 'super-sub', name: 'Super Sub', scale: 1 },
  { id: 'nemo', name: 'NEMO 2', scale: .74 },
  { id: 'c-explorer', name: 'C-Explorer 3', scale: .81 },
  { id: 'c-researcher', name: 'C-Researcher 3', scale: .89 },
  { id: 'greyshark', name: 'GREYSHARK MK II', scale: 1.08 },
  { id: 'c-explorer-5', name: 'C-Explorer 5', scale: .92 },
  { id: 'c-quester-2', name: 'C-Quester 2', scale: .73 },
  { id: 'cruise-sub-7', name: 'Cruise Sub 7', scale: 1 },
  { id: 'super-yacht-sub-3', name: 'Super Yacht Sub 3', scale: .79 }
];
const allKelpModels = (1 << kelpModels.length) - 1;

function kelpModelMask({ submersibles, submersible, vessel }) {
  if (Number.isInteger(submersibles) && submersibles >= 0 && submersibles <= allKelpModels) return submersibles;
  const previous = Number.isFinite(submersible)
    ? Math.min(kelpModels.length, Math.max(0, Math.round(submersible)))
    : Number.isInteger(vessel) ? Math.min(5, Math.max(0, vessel - 1)) : undefined;
  if (previous === undefined) return undefined;
  return previous === 0 ? allKelpModels : 1 << (previous - 1);
}
