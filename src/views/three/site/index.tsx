import type * as THREE from 'three';
import type { Design } from '../../../model/schema';
import type { SiteGeom } from '../../../model/site';
import type { Frame } from '../House3D';
import { DockMesh } from './Dock';
import { Fence } from './Fence';
import { LotLines } from './LotLines';
import { Shoreline } from './Shoreline';
import { Terrain } from './Terrain';
import { Trees } from './Trees';
import { Water } from './Water';

export type SiteOptions = { showLot: boolean; showTrees: boolean };

/** The full landscape for a design with a `site` block. */
export function SiteScene(props: {
  design: Design;
  fr: Frame;
  g: NonNullable<SiteGeom>;
  options: SiteOptions;
  avoid: (p: THREE.Vector3) => boolean;
}) {
  const { design, fr, g, options } = props;
  return (
    <group>
      <Terrain fr={fr} g={g} />
      <Shoreline fr={fr} g={g} />
      <Water fr={fr} g={g} />
      <DockMesh design={design} fr={fr} g={g} />
      <Fence fr={fr} g={g} />
      {options.showTrees && <Trees design={design} fr={fr} g={g} avoid={props.avoid} />}
      {options.showLot && <LotLines fr={fr} g={g} />}
    </group>
  );
}
