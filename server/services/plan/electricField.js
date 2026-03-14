import { normalizeScenePlan } from "../../../src/ai/planSchema.js";

function chargeColor(value) {
  return value >= 0 ? "#ffd966" : "#48c9ff";
}

function chargeLabel(value, index = 0) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}Q${index ? index + 1 : ""}`;
}

function buildChargeSuggestion({ id, charge, position, index = 0, title = "Charge" }) {
  return {
    id,
    title,
    purpose: "Move this charge to see how the field direction and density change.",
    optional: false,
    tags: ["physics", "charge", charge >= 0 ? "positive" : "negative"],
    roles: ["charge", charge >= 0 ? "positive" : "negative"],
    object: {
      id: `${id}-object`,
      label: chargeLabel(charge, index),
      shape: "sphere",
      color: chargeColor(charge),
      position,
      rotation: [0, 0, 0],
      params: { radius: 0.42 },
      metadata: {
        role: "charge",
        roles: ["charge", charge >= 0 ? "positive" : "negative"],
        physics: {
          kind: "charge",
          charge,
          polarity: charge >= 0 ? "positive" : "negative",
          strength: Math.abs(charge),
        },
      },
    },
  };
}

function buildGaussianSurface() {
  return {
    id: "gaussian-surface",
    title: "Gaussian surface",
    purpose: "Use this transparent surface to inspect whether field lines leave or enter the region.",
    optional: true,
    tags: ["physics", "flux", "reference"],
    roles: ["reference", "gaussian-surface"],
    object: {
      id: "gaussian-surface-object",
      label: "Gaussian surface",
      shape: "sphere",
      color: "#7cf7e4",
      position: [0, 1.1, 0],
      rotation: [0, 0, 0],
      params: { radius: 1.75 },
      metadata: {
        role: "gaussian-surface",
        roles: ["reference", "gaussian-surface"],
        physics: {
          kind: "flux_surface",
          sampleRadius: 1.75,
        },
      },
    },
  };
}

function subtypeForQuestion(question = "") {
  const lower = String(question || "").toLowerCase();
  if (!/\b(electric|electrostatic|charge|dipole|flux|gauss|gaussian|field line|electron flow)\b/.test(lower)) {
    return null;
  }
  if (/\b(flux|gauss|gaussian|divergence)\b/.test(lower)) {
    return "flux";
  }
  if (/\b(dipole|opposite charges|equal and opposite|positive and negative|two charges)\b/.test(lower)) {
    return "dipole";
  }
  return "single_charge";
}

function buildPlanFields(_questionText, _sourceSummary = {}, subtype) {
  if (subtype === "flux") {
    return {
      overview: "Nova built an electric-field playground with a Gaussian surface so the learner can see flux as field lines crossing a boundary.",
      sceneFocus: {
        concept: "electric flux",
        primaryInsight: "Flux depends on whether field lines leave or enter the chosen surface, not just on the surface size.",
        focusPrompt: "Focus on where the field lines pierce the Gaussian surface.",
        judgeSummary: "The learner moves charges and explains how the field crossing the surface changes.",
      },
      answerScaffold: {
        finalAnswer: null,
        unit: "",
        formula: "Phi_E = Q_enclosed / epsilon_0",
        explanation: "Watch whether field lines leave or enter the Gaussian surface as you move the enclosed charge.",
        checks: [
          "Is the source charge inside or outside the Gaussian surface?",
          "Do more field lines leave the surface than enter it?",
        ],
      },
    };
  }

  if (subtype === "dipole") {
    return {
      overview: "Nova built an electric dipole so the learner can drag the charges and watch the field bend between them in real time.",
      sceneFocus: {
        concept: "electric dipole field",
        primaryInsight: "Field lines leave the positive charge and bend toward the negative charge.",
        focusPrompt: "Focus on how the arrows and particles curve between the two charges.",
        judgeSummary: "The learner drags the dipole and explains how the field reorganizes.",
      },
      answerScaffold: {
        finalAnswer: null,
        unit: "",
        formula: "E approx kQ / r^2",
        explanation: "Look at where the arrows crowd together and where the electron-flow particles are pulled most strongly.",
        checks: [
          "Which way would a positive test charge move?",
          "What changes when the charges move closer together?",
        ],
      },
    };
  }

  return {
    overview: "Nova built a single-charge field scene so the learner can connect arrow direction, density, and particle motion to electric force.",
    sceneFocus: {
      concept: "electric field around a charge",
      primaryInsight: "Field arrows point away from positive charge and toward negative charge, while electron flow moves the opposite way.",
      focusPrompt: "Focus on how direction and density change as you move farther from the charge.",
      judgeSummary: "The learner drags a charge and explains how the field reacts.",
    },
    answerScaffold: {
      finalAnswer: null,
      unit: "",
      formula: "E = kQ / r^2",
      explanation: "Use the field density and arrow direction to connect the picture to Coulomb-style reasoning.",
      checks: [
        "Which way would a positive test charge move?",
        "How does the field change when the charge strength or distance changes?",
      ],
    },
  };
}

function buildObjects(subtype) {
  if (subtype === "dipole") {
    return [
      buildChargeSuggestion({
        id: "charge-positive",
        title: "Positive charge",
        charge: 1,
        index: 0,
        position: [-1.75, 1.1, 0],
      }),
      buildChargeSuggestion({
        id: "charge-negative",
        title: "Negative charge",
        charge: -1,
        index: 1,
        position: [1.75, 1.1, 0],
      }),
    ];
  }

  if (subtype === "flux") {
    return [
      buildChargeSuggestion({
        id: "charge-source",
        title: "Enclosed charge",
        charge: 1,
        index: 0,
        position: [0, 1.1, 0],
      }),
      buildGaussianSurface(),
    ];
  }

  return [
    buildChargeSuggestion({
      id: "charge-source",
      title: "Source charge",
      charge: 1,
      index: 0,
      position: [0, 1.1, 0],
    }),
  ];
}

function buildFieldSteps(objectSuggestions, subtype) {
  const suggestionIds = objectSuggestions.map((suggestion) => suggestion.id);
  const chargeIds = objectSuggestions.filter((suggestion) => suggestion.roles.includes("charge")).map((suggestion) => suggestion.id);

  return [
    {
      id: "step-observe-field",
      title: "Observe the field",
      instruction: "Look at the field arrows and particles first. Which way would a positive test charge move?",
      hint: "Arrow direction shows the force on a positive test charge.",
      action: "observe",
      focusConcept: "field direction",
      coachPrompt: "Start by naming the field direction before you move anything.",
      suggestedObjectIds: chargeIds,
      requiredObjectIds: chargeIds,
      cameraBookmarkId: "field-overview",
      highlightObjectIds: objectSuggestions.map((suggestion) => suggestion.object.id),
    },
    {
      id: "step-drag-charge",
      title: subtype === "flux" ? "Move the charge through the surface" : "Drag the charges",
      instruction: subtype === "flux"
        ? "Move the enclosed charge and watch how the field crossing the Gaussian surface changes."
        : "Drag a charge and watch how the flow lines and density reorganize.",
      hint: subtype === "flux"
        ? "Flux depends on the charge enclosed by the surface."
        : "Closer charges create stronger bending and denser arrows.",
      action: "observe",
      focusConcept: subtype === "flux" ? "flux through a surface" : "field density",
      coachPrompt: "Use motion in the scene before you reach for the formula.",
      suggestedObjectIds: suggestionIds,
      requiredObjectIds: chargeIds,
      cameraBookmarkId: "field-overview",
      highlightObjectIds: objectSuggestions.map((suggestion) => suggestion.object.id),
    },
  ];
}

function buildLearningMoments(subtype) {
  const predictPrompt = subtype === "flux"
    ? "If the charge moves outside the Gaussian surface, what do you think happens to the net outward flow?"
    : subtype === "dipole"
      ? "If the charges move closer together, where do you think the field gets denser?"
      : "If you drag the charge farther away, how do you think the field strength changes?";

  const reflectGoal = subtype === "flux"
    ? "Explain why the field crossing the surface depends on enclosed charge."
    : subtype === "dipole"
      ? "Explain why the field bends from positive toward negative."
      : "Explain how distance changes the visible field strength.";

  return {
    orient: {
      stage: "orient",
      title: "Observe",
      coachMessage: "Start with the arrows. They show the force direction on a positive test charge.",
      goal: "Name the field direction before moving anything.",
      prompt: "",
      insight: "",
      whyItMatters: "The field picture should come before the equation.",
    },
    build: {
      stage: "build",
      title: "Explore",
      coachMessage: "Now drag the charges and watch the field react immediately.",
      goal: "Use movement in the scene to test your intuition.",
      prompt: "",
      insight: "",
      whyItMatters: "Motion makes invisible field changes concrete.",
    },
    predict: {
      stage: "predict",
      title: "Predict",
      coachMessage: "Make one short prediction from the field before the tutor explains it.",
      goal: "Commit to a force, density, or flux prediction.",
      prompt: predictPrompt,
      insight: "",
      whyItMatters: "Prediction turns the simulation into reasoning practice.",
    },
    check: {
      stage: "check",
      title: "Check",
      coachMessage: "Use the live field to test your prediction.",
      goal: "Compare the arrows, density, and flow to what you expected.",
      prompt: "",
      insight: "",
      whyItMatters: "The visualization gives immediate feedback.",
    },
    reflect: {
      stage: "reflect",
      title: "Reflect",
      coachMessage: "State the key field idea in one sentence.",
      goal: reflectGoal,
      prompt: "",
      insight: "",
      whyItMatters: "A short explanation helps the visual pattern stick.",
    },
    challenge: {
      stage: "challenge",
      title: "Challenge",
      coachMessage: "Try one more move and predict the outcome before you test it.",
      goal: "Transfer the same field idea to a new position.",
      prompt: predictPrompt,
      insight: "",
      whyItMatters: "A small follow-up checks whether the intuition transfers.",
    },
  };
}

export function buildElectricFieldPlan(questionText = "", sourceSummary = {}) {
  const subtype = subtypeForQuestion(sourceSummary.cleanedQuestion || questionText);
  if (!subtype) return null;

  const question = sourceSummary.cleanedQuestion || questionText;
  const objectSuggestions = buildObjects(subtype);
  const buildSteps = buildFieldSteps(objectSuggestions, subtype);
  const fields = buildPlanFields(questionText, sourceSummary, subtype);
  const cameraBookmarks = [{
    id: "field-overview",
    label: "Field overview",
    description: "Frame the charges and the responsive field.",
    position: [8, 6.5, 8],
    target: [0, 1.1, 0],
  }];

  return normalizeScenePlan({
    problem: {
      id: `electric-field-${subtype}`,
      question,
      questionType: "spatial",
      summary: fields.sceneFocus.primaryInsight,
      mode: "guided",
    },
    overview: fields.overview,
    sourceSummary: sourceSummary.cleanedQuestion
      ? sourceSummary
      : {
        inputMode: "text",
        rawQuestion: question,
        cleanedQuestion: question,
        givens: [],
        labels: [],
        relationships: ["electric field"],
        diagramSummary: "",
        conflicts: [],
      },
    sceneFocus: fields.sceneFocus,
    learningMoments: buildLearningMoments(subtype),
    objectSuggestions,
    buildSteps,
    cameraBookmarks,
    answerScaffold: fields.answerScaffold,
    lessonStages: buildSteps.map((step) => ({
      id: step.id,
      title: step.title,
      goal: step.instruction,
      tutorIntro: step.coachPrompt,
      checkpointPrompt: subtype === "flux"
        ? "Does the field crossing the surface match your prediction?"
        : "Does the field bend the way you expected?",
      highlightTargets: step.highlightObjectIds,
    })),
    challengePrompts: [{
      id: "field-challenge",
      prompt: subtype === "flux"
        ? "Explain what changes when the charge moves outside the Gaussian surface."
        : subtype === "dipole"
          ? "Explain why the field gets denser between the charges."
          : "Explain why the arrows thin out as you move away from the charge.",
      expectedKind: "explanation",
      expectedAnswer: null,
      tolerance: 0,
    }],
  });
}
