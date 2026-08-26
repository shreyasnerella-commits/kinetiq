import * as tf from "@tensorflow/tfjs";
import Papa from "papaparse";

export interface RecoveryPlanResponse {
  overallAssessment: string;
  readinessScore: number;
  nitrogenBalanceStatus: "Optimal" | "Deficit" | "Surplus";
  sleepTargetHours: number;
  hydrationLiters: number;
  nutritionAdvice: string;
  trainingGuidanceTomorrow: string;
  actionItems: string[];
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
}

let cachedModel: tf.LayersModel | null = null;

export async function trainOnWhoopDataset(
  onProgress?: (progress: TrainingProgress) => void,
  maxSamples = 15000
): Promise<tf.LayersModel> {
  const response = await fetch("/whoop_100k.csv");
  const csvText = await response.text();

  const parsed = Papa.parse<any>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  const rawRows = parsed.data.slice(0, maxSamples);
  const features: number[][] = [];
  const labels: number[][] = [];

  for (const row of rawRows) {
    const strain = typeof row.day_strain === "number" ? row.day_strain : 10;
    const hr = typeof row.avg_heart_rate === "number" ? row.avg_heart_rate : 60;
    const dur = typeof row.activity_duration_min === "number" ? row.activity_duration_min : 45;
    const sleepPerf = typeof row.sleep_performance === "number" ? row.sleep_performance : 75;
    const recovery = typeof row.recovery_score === "number" ? row.recovery_score : 65;
    const sleepHrs = typeof row.sleep_hours === "number" ? row.sleep_hours : 7.5;

    features.push([
      Math.min(1.0, strain / 21.0),
      Math.min(1.0, (hr - 40) / 140.0),
      Math.min(1.0, dur / 180.0),
      Math.min(1.0, sleepPerf / 100.0),
      0.9
    ]);

    labels.push([
      Math.min(1.0, recovery / 100.0),
      Math.min(1.0, (sleepHrs - 4.0) / 6.0)
    ]);
  }

  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [5], units: 48, activation: "relu" }));
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 24, activation: "relu" }));
  model.add(tf.layers.dense({ units: 2, activation: "sigmoid" }));

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: "meanSquaredError",
  });

  const xs = tf.tensor2d(features);
  const ys = tf.tensor2d(labels);

  const epochs = 40;
  await model.fit(xs, ys, {
    epochs,
    batchSize: 64,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (onProgress) {
          onProgress({
            epoch: epoch + 1,
            totalEpochs: epochs,
            loss: parseFloat((logs?.loss || 0).toFixed(4)),
          });
        }
      },
    },
  });

  xs.dispose();
  ys.dispose();

  try {
    await model.save("indexeddb://runai_whoop_model_v1");
  } catch {}

  cachedModel = model;
  return model;
}

export async function getOrLoadWhoopModel(): Promise<tf.LayersModel> {
  if (cachedModel) return cachedModel;
  try {
    cachedModel = await tf.loadLayersModel("indexeddb://runai_whoop_model_v1");
    return cachedModel;
  } catch {
    return await trainOnWhoopDataset();
  }
}

export async function predictWhoopRecovery(data: {
  proteinConsumed: number;
  proteinTarget: number;
  caloriesConsumed: number;
  calorieTarget: number;
  totalWorkoutStrain: number;
  totalRunStrain: number;
  totalRunKm: number;
  restingHr: number;
  workoutDurationMin: number;
}): Promise<RecoveryPlanResponse> {
  const model = await getOrLoadWhoopModel();

  const combinedStrain = data.totalWorkoutStrain + data.totalRunStrain;
  const whoopStrainEquiv = Math.min(21.0, combinedStrain / 6.0);
  const pRatio = Math.min(1.5, data.proteinConsumed / (data.proteinTarget || 1));

  const strainNorm = Math.min(1.0, whoopStrainEquiv / 21.0);
  const hrNorm = Math.min(1.0, (data.restingHr - 40) / 140.0);
  const durNorm = Math.min(1.0, data.workoutDurationMin / 180.0);
  const sleepPerfNorm = pRatio >= 0.9 ? 0.85 : 0.65;

  const inputTensor = tf.tensor2d([[strainNorm, hrNorm, durNorm, sleepPerfNorm, pRatio]]);
  const prediction = model.predict(inputTensor) as tf.Tensor;
  const values = prediction.dataSync();

  inputTensor.dispose();
  prediction.dispose();

  const readinessScore = Math.round(values[0] * 100);
  const sleepTargetHours = parseFloat((4.0 + values[1] * 6.0).toFixed(1));
  const hydrationLiters = parseFloat((2.5 + (whoopStrainEquiv / 21.0) * 2.0).toFixed(1));

  let nitrogenBalanceStatus: "Optimal" | "Deficit" | "Surplus" = "Optimal";
  if (pRatio < 0.75) nitrogenBalanceStatus = "Deficit";
  else if (pRatio > 1.25) nitrogenBalanceStatus = "Surplus";

  let trainingGuidanceTomorrow = "Optimal Load: Zone 2 Aerobic + Hypertrophy";
  if (readinessScore < 34) {
    trainingGuidanceTomorrow = "Red Zone: Complete Rest or 20-min Gentle Mobility";
  } else if (readinessScore < 67) {
    trainingGuidanceTomorrow = "Yellow Zone: Moderate Load / Maintenance Only";
  }

  return {
    overallAssessment: `Equivalent Day Strain is ${whoopStrainEquiv.toFixed(1)}/21 with a calculated readiness score of ${readinessScore}%. Resting HR: ${data.restingHr} BPM.`,
    readinessScore,
    nitrogenBalanceStatus,
    sleepTargetHours,
    hydrationLiters,
    nutritionAdvice: nitrogenBalanceStatus === "Deficit" ? "Deficit detected. Add 30g protein post-workout or before sleep." : "Fueling aligns well with metabolic demand.",
    trainingGuidanceTomorrow,
    actionItems: [
      `Sleep Prescription: ${sleepTargetHours} hours to restore autonomic nervous tone.`,
      `Hydration Intake: ${hydrationLiters}L fluids with sodium and potassium electrolytes.`,
      nitrogenBalanceStatus === "Deficit"
        ? `Protein shortfall of ${(data.proteinTarget - data.proteinConsumed).toFixed(0)}g — supplement with whey/casein or eggs.`
        : "Protein status is primed for overnight muscular adaptation."
    ],
  };
}