import test from "node:test";
import assert from "node:assert/strict";

import { buildElectricFieldPlan } from "../server/services/plan/electricField.js";

test("buildElectricFieldPlan creates a single-charge playground with physics metadata", () => {
  const plan = buildElectricFieldPlan("Show the electric field around a positive charge.");

  assert.ok(plan);
  assert.equal(plan.problem.id, "electric-field-single_charge");
  assert.equal(plan.objectSuggestions.length, 1);
  assert.equal(plan.objectSuggestions[0].object.metadata.physics.charge, 1);
  assert.equal(plan.objectSuggestions[0].object.metadata.physics.kind, "charge");
});

test("buildElectricFieldPlan creates a dipole playground with opposite charges", () => {
  const plan = buildElectricFieldPlan("Build a dipole with two opposite charges and explain the field lines.");

  assert.ok(plan);
  const charges = plan.objectSuggestions.filter((suggestion) => suggestion.object.metadata.physics?.kind === "charge");
  assert.equal(charges.length, 2);
  assert.deepEqual(charges.map((suggestion) => suggestion.object.metadata.physics.charge), [1, -1]);
});

test("buildElectricFieldPlan creates a flux scene with a Gaussian surface", () => {
  const plan = buildElectricFieldPlan("Use Gauss's law to explain electric flux through a Gaussian surface.");

  assert.ok(plan);
  const fluxSurface = plan.objectSuggestions.find((suggestion) => suggestion.object.metadata.physics?.kind === "flux_surface");
  assert.ok(fluxSurface);
  assert.match(plan.answerScaffold.formula, /Phi_E/);
});
