import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { createGrassProbe, grassHeight, grassRecovery } from '../lib/grass.ts';

const lawn = (name: string, y = 0) => {
  const mesh = new Mesh(new BoxGeometry(40, .1, 40), new MeshStandardMaterial({ name }));
  mesh.position.y = y;
  mesh.updateMatrixWorld(true);
  return mesh;
};

test('only planting surfaces grow blades, and never taller than a mown campus lawn', () => {
  for (const name of ['Campus | varied monsoon ground', 'Library | grass', 'Campus | turf',
                      'Cricket | packed drone turf and worn central strip', 'Site | lawn']) {
    const height = grassHeight(name);
    assert.ok(height > 0 && height < .25, `${name} should plant short grass, got ${height}`);
  }
  for (const name of ['Campus | asphalt', 'Library | path', 'Library | roof',
                      'Campus | warm ochre paver stripes', 'Library | glass', '']) {
    assert.equal(grassHeight(name), 0, `${name} must stay clear`);
  }
});

test('a covered lawn is left bare, an open one is planted', () => {
  const ground = lawn('Campus | varied monsoon ground');
  // Nothing above the lawn: the blades belong there.
  const open = createGrassProbe([ground], () => 0);
  const surface = open(3, -4);
  assert.ok(surface, 'open lawn must be planted');
  assert.ok(surface!.y > .04 && surface!.y < .06, `blade roots sit on the surface, got ${surface!.y}`);
  assert.equal(surface!.height, grassHeight('Campus | varied monsoon ground'));
  // A road, court or building deck resting on the same lawn hides it.
  assert.equal(createGrassProbe([ground], () => .3)(3, -4), null);
  // Millimetre export tolerances stay planted, but thin administration pavers
  // 2cm above the lawn must cover the blades just like a thick road deck.
  assert.ok(createGrassProbe([ground], () => .055)(3, -4));
  assert.equal(createGrassProbe([ground], () => .07)(3, -4), null);
  // Off the campus entirely.
  assert.equal(open(-900, 0), null);
});

test('a lawn far above the ground, such as a roof garden, is never planted', () => {
  const roof = lawn('Library | grass', 9);
  assert.equal(createGrassProbe([roof], () => null)(0, 0), null);
  // The same height of ordinary campus ground is a roof too.
  assert.equal(createGrassProbe([lawn('Campus | varied monsoon ground', 3.7)], () => null)(0, 0), null);
});

test("the administration's lawns are planted all the way up to its raised podium", () => {
  const slope = lawn('Site | lawn', 3.7);
  const surface = createGrassProbe([slope], () => null)(0, 0);
  assert.ok(surface && surface.y > 3.7, 'the raised lawn beside the podium must be planted');
  assert.equal(createGrassProbe([lawn('Site | lawn', 9)], () => null)(0, 0), null);
});

test('trampled blades spring back and settle', () => {
  assert.ok(grassRecovery(0) > .9, 'a fresh footprint is fully bent');
  assert.ok(Math.abs(grassRecovery(4)) < .01, 'the blade is standing again after four seconds');
  assert.ok(Math.max(...[1, 2, 3].map(t => Math.abs(grassRecovery(t)))) < Math.abs(grassRecovery(0)));
});
