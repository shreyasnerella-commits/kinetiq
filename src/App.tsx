import React, { useState, useEffect, useMemo } from "react";
import { 
  Activity,
  Dumbbell, 
  HeartPulse, 
  Zap, 
  Sparkles, 
  Trash2, 
  Flame, 
  Layers, 
  UtensilsCrossed, 
  Plus, 
  Search, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Footprints, 
  Calendar, 
  History, 
  Clock, 
  Loader2, 
  ArrowRight
} from "lucide-react";
import { 
  ResponsiveContainer as ResponsiveContainerOrig, 
  ComposedChart as ComposedChartOrig, 
  AreaChart as AreaChartOrig, 
  Area as AreaOrig, 
  XAxis as XAxisOrig, 
  YAxis as YAxisOrig, 
  Tooltip as TooltipOrig, 
  BarChart as BarChartOrig, 
  Bar as BarOrig, 
  ReferenceLine as ReferenceLineOrig 
} from "recharts";
import { db } from "./lib/firebase";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  query, 
  orderBy 
} from "firebase/firestore";
import { FOOD_DATABASE, type FoodPreset } from "./data/foodDatabase";
import { 
  predictWhoopRecovery, 
  type RecoveryPlanResponse 
} from "./lib/whoopML";

const ResponsiveContainer = ResponsiveContainerOrig as any;
const ComposedChart = ComposedChartOrig as any;
const AreaChart = AreaChartOrig as any;
const BarChart = BarChartOrig as any;
const Area = AreaOrig as any;
const XAxis = XAxisOrig as any;
const YAxis = YAxisOrig as any;
const Tooltip = TooltipOrig as any;
const Bar = BarOrig as any;
const ReferenceLine = ReferenceLineOrig as any;

interface WorkoutItem {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight: number;
  strain: number;
  logDate: string;
}

interface RunItem {
  id: string;
  distanceKm: number;
  durationMin: number;
  avgHr: number;
  strain: number;
  date: string;
  logDate: string;
}

interface LoggedFoodItem {
  id: string;
  name: string;
  portion: string;
  servings: number;
  calories: number;
  protein: number;
  logDate: string;
}

const STATIC_RECOMP = [
  { day: "W1", weight: 78.5 },
  { day: "W2", weight: 78.1 },
  { day: "W3", weight: 77.6 },
  { day: "W4", weight: 77.2 },
];

const PRESET_EXERCISES = [
  "Barbell Back Squat",
  "Romanian Deadlift",
  "Flat Barbell Bench Press",
  "Overhead Shoulder Press",
  "Barbell Bent-Over Row",
  "Pull-Ups (Weighted/Body)",
  "Walking Dumbbell Lunges",
  "Leg Press"
];

const getTodayDateKey = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "workouts" | "nutrition" | "run" | "recovery">("overview");
  const [nutritionSubTab, setNutritionSubTab] = useState<"add" | "history">("add");
  const [historyMetric, setHistoryMetric] = useState<"protein" | "calories">("protein");
  const todayKey = getTodayDateKey();

  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>(todayKey);

  // Recovery ML State
  const [mlPlan, setMlPlan] = useState<RecoveryPlanResponse | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState("");

  // Persistent Collections
  const [allWorkoutHistory, setAllWorkoutHistory] = useState<WorkoutItem[]>(() => {
    const saved = localStorage.getItem("kinetiq_workouts_all");
    return saved ? JSON.parse(saved) : [];
  });

  const [allFoodLogs, setAllFoodLogs] = useState<LoggedFoodItem[]>(() => {
    const saved = localStorage.getItem("kinetiq_foods_all");
    return saved ? JSON.parse(saved) : [];
  });

  const [allRuns, setAllRuns] = useState<RunItem[]>(() => {
    const saved = localStorage.getItem("kinetiq_runs_all");
    return saved ? JSON.parse(saved) : [];
  });

  // Derived Today Logs
  const workoutList = useMemo(() => allWorkoutHistory.filter(item => item.logDate === todayKey), [allWorkoutHistory, todayKey]);
  const loggedFoods = useMemo(() => allFoodLogs.filter(item => item.logDate === todayKey), [allFoodLogs, todayKey]);
  const loggedRuns = useMemo(() => allRuns.filter(item => item.logDate === todayKey), [allRuns, todayKey]);

  useEffect(() => { localStorage.setItem("kinetiq_workouts_all", JSON.stringify(allWorkoutHistory)); }, [allWorkoutHistory]);
  useEffect(() => { localStorage.setItem("kinetiq_foods_all", JSON.stringify(allFoodLogs)); }, [allFoodLogs]);
  useEffect(() => { localStorage.setItem("kinetiq_runs_all", JSON.stringify(allRuns)); }, [allRuns]);

  // Form Inputs
  const [selectedExercise, setSelectedExercise] = useState(PRESET_EXERCISES[0]);
  const [customExercise, setCustomExercise] = useState("");
  const [sets, setSets] = useState<number | "">("");
  const [reps, setReps] = useState<number | "">("");
  const [weight, setWeight] = useState<number | "">("");

  const [selectedFoodIndex, setSelectedFoodIndex] = useState<number>(0);
  const [presetServings, setPresetServings] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchServings] = useState<number>(1);
  const [customFoodName, setCustomFoodName] = useState("");
  const [customFoodPortion, setCustomFoodPortion] = useState("");
  const [customFoodCals, setCustomFoodCals] = useState<number | "">("");
  const [customFoodProt, setCustomFoodProt] = useState<number | "">("");

  const [runDistance, setRunDistance] = useState("");
  const [runDuration, setRunDuration] = useState("");
  const [avgHeartRate, setAvgHeartRate] = useState("");
  const [bodyWeight, setBodyWeight] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const CALORIE_TARGET = 2200;
  const PROTEIN_TARGET = 165;
  const OPTIMAL_STRAIN_LIMIT = 120.0;
  const RESTING_HR_BASELINE = 48;

  // Real-time Firestore listeners
  useEffect(() => {
    if (!db) return;

    try {
      const qWorkouts = query(collection(db, "workouts"), orderBy("createdAt", "desc"));
      const unsubWorkouts = onSnapshot(qWorkouts, (snapshot) => {
        setAllWorkoutHistory(snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          name: docSnap.data().name,
          sets: docSnap.data().sets,
          reps: docSnap.data().reps,
          weight: docSnap.data().weight,
          strain: docSnap.data().strain,
          logDate: docSnap.data().logDate || todayKey,
        })));
      }, () => {});

      const qNutrition = query(collection(db, "nutrition_logs"), orderBy("createdAt", "desc"));
      const unsubNutrition = onSnapshot(qNutrition, (snapshot) => {
        setAllFoodLogs(snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          name: docSnap.data().name,
          portion: docSnap.data().portion,
          servings: docSnap.data().servings,
          calories: docSnap.data().calories,
          protein: docSnap.data().protein,
          logDate: docSnap.data().logDate || todayKey,
        })));
      }, () => {});

      const qRuns = query(collection(db, "run_logs"), orderBy("createdAt", "desc"));
      const unsubRuns = onSnapshot(qRuns, (snapshot) => {
        setAllRuns(snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          distanceKm: docSnap.data().distanceKm,
          durationMin: docSnap.data().durationMin,
          avgHr: docSnap.data().avgHr,
          strain: docSnap.data().strain,
          date: docSnap.data().date,
          logDate: docSnap.data().logDate || todayKey,
        })));
      }, () => {});

      return () => {
        unsubWorkouts();
        unsubNutrition();
        unsubRuns();
      };
    } catch {}
  }, [todayKey]);

  // Derived metrics
  const totalWorkoutStrain = workoutList.reduce((acc, item) => acc + item.strain, 0);
  const totalRunStrain = loggedRuns.reduce((acc, item) => acc + item.strain, 0);
  const totalRunKm = loggedRuns.reduce((acc, item) => acc + item.distanceKm, 0);
  const combinedTotalStrain = parseFloat((totalWorkoutStrain + totalRunStrain).toFixed(1));

  const totalCaloriesConsumed = Math.round(loggedFoods.reduce((acc, item) => acc + item.calories, 0));
  const totalProteinConsumed = parseFloat(loggedFoods.reduce((acc, item) => acc + item.protein, 0).toFixed(1));

  const strainPercentage = Math.min(150, (combinedTotalStrain / OPTIMAL_STRAIN_LIMIT) * 100);
  const recoveryState = combinedTotalStrain > OPTIMAL_STRAIN_LIMIT 
    ? "OVERREACHING" 
    : combinedTotalStrain >= 70 
    ? "OPTIMAL ADAPTATION" 
    : "UNDER-LOADED";

  const historyWeeklyChartData = useMemo(() => {
    const daysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const [y, m, d] = selectedHistoryDate.split("-").map(Number);
    const baseDate = new Date(y, m - 1, d);
    const dayOfWeek = baseDate.getDay();
    
    const sunday = new Date(baseDate);
    sunday.setDate(baseDate.getDate() - dayOfWeek);

    return daysShort.map((dayLabel, idx) => {
      const currentDay = new Date(sunday);
      currentDay.setDate(sunday.getDate() + idx);
      
      const year = currentDay.getFullYear();
      const month = String(currentDay.getMonth() + 1).padStart(2, "0");
      const day = String(currentDay.getDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;

      const dayMeals = allFoodLogs.filter(f => f.logDate === dateKey);
      const dayProtein = parseFloat(dayMeals.reduce((acc, item) => acc + item.protein, 0).toFixed(1));
      const dayCalories = Math.round(dayMeals.reduce((acc, item) => acc + item.calories, 0));

      return {
        day: dayLabel,
        fullDate: dateKey,
        protein: dayProtein,
        calories: dayCalories,
        proteinAvg: dayProtein > 0 ? dayProtein * 1.15 : 45,
        caloriesAvg: dayCalories > 0 ? dayCalories * 1.1 : 800,
      };
    });
  }, [allFoodLogs, selectedHistoryDate]);

  const historyDayFoods = useMemo(() => allFoodLogs.filter(item => item.logDate === selectedHistoryDate), [allFoodLogs, selectedHistoryDate]);
  const historyDayCalories = Math.round(historyDayFoods.reduce((acc, item) => acc + item.calories, 0));
  const historyDayProtein = parseFloat(historyDayFoods.reduce((acc, item) => acc + item.protein, 0).toFixed(1));

  const filteredFoods = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return FOOD_DATABASE.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery]);

  const runChartData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.map((day, idx) => ({
      day,
      km: loggedRuns[idx] ? loggedRuns[idx].distanceKm : 0
    }));
  }, [loggedRuns]);

  // Local ML Recovery Diagnosis Execution
  const handleRunDiagnosis = async () => {
    setMlLoading(true);
    setMlError("");
    try {
      const plan = await predictWhoopRecovery({
        proteinConsumed: totalProteinConsumed,
        proteinTarget: PROTEIN_TARGET,
        caloriesConsumed: totalCaloriesConsumed,
        calorieTarget: CALORIE_TARGET,
        totalWorkoutStrain,
        totalRunStrain,
        totalRunKm,
        restingHr: RESTING_HR_BASELINE,
        workoutDurationMin: Math.max(30, workoutList.length * 15),
      });
      setMlPlan(plan);
    } catch (err: any) {
      setMlError(err.message || "Failed to compute recovery diagnosis.");
    } finally {
      setMlLoading(false);
    }
  };

  // CRUD Handlers
  const handleAddWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalExerciseName = customExercise.trim() || selectedExercise;
    const numSets = Number(sets);
    const numReps = Number(reps);
    const numWeight = Number(weight);
    if (!numSets || !numReps || isNaN(numWeight)) return;

    const itemStrain = parseFloat(((numSets * numReps * numWeight) / 100).toFixed(1));
    const newWorkout: WorkoutItem = {
      id: Date.now().toString(),
      name: finalExerciseName,
      sets: numSets,
      reps: numReps,
      weight: numWeight,
      strain: itemStrain,
      logDate: todayKey
    };

    setAllWorkoutHistory(prev => [newWorkout, ...prev]);
    if (db) {
      try {
        await addDoc(collection(db, "workouts"), {
          name: finalExerciseName,
          sets: numSets,
          reps: numReps,
          weight: numWeight,
          strain: itemStrain,
          logDate: todayKey,
          createdAt: new Date().toISOString()
        });
      } catch {}
    }
    setSets(""); setReps(""); setWeight(""); setCustomExercise("");
  };

  const handleDeleteWorkout = async (id: string) => {
    setAllWorkoutHistory(prev => prev.filter(item => item.id !== id));
    if (db) {
      try { await deleteDoc(doc(db, "workouts", id)); } catch {}
    }
  };

  const handleAddDropdownFood = async (e: React.FormEvent) => {
    e.preventDefault();
    const food = FOOD_DATABASE[selectedFoodIndex];
    if (!food) return;

    const servings = Math.max(0.1, Number(presetServings) || 1);
    const newFood: LoggedFoodItem = {
      id: Date.now().toString(),
      name: food.name,
      portion: food.portion,
      servings: servings,
      calories: Math.round(food.calories * servings),
      protein: parseFloat((food.protein * servings).toFixed(1)),
      logDate: todayKey
    };

    setAllFoodLogs(prev => [newFood, ...prev]);
    if (db) {
      try {
        await addDoc(collection(db, "nutrition_logs"), {
          name: food.name,
          portion: food.portion,
          servings,
          calories: newFood.calories,
          protein: newFood.protein,
          logDate: todayKey,
          createdAt: new Date().toISOString()
        });
      } catch {}
    }
  };

  const handleAddSearchedFood = async (food: FoodPreset) => {
    const servings = Math.max(0.1, Number(searchServings) || 1);
    const newFood: LoggedFoodItem = {
      id: Date.now().toString(),
      name: food.name,
      portion: food.portion,
      servings,
      calories: Math.round(food.calories * servings),
      protein: parseFloat((food.protein * servings).toFixed(1)),
      logDate: todayKey
    };

    setAllFoodLogs(prev => [newFood, ...prev]);
    if (db) {
      try {
        await addDoc(collection(db, "nutrition_logs"), {
          name: food.name,
          portion: food.portion,
          servings,
          calories: newFood.calories,
          protein: newFood.protein,
          logDate: todayKey,
          createdAt: new Date().toISOString()
        });
      } catch {}
    }
    setSearchQuery("");
  };

  const handleAddCustomFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFoodName.trim() || !customFoodCals || customFoodProt === "") return;

    const newFood: LoggedFoodItem = {
      id: Date.now().toString(),
      name: customFoodName.trim(),
      portion: customFoodPortion.trim() || "1 serving",
      servings: 1,
      calories: Number(customFoodCals),
      protein: Number(customFoodProt),
      logDate: todayKey
    };

    setAllFoodLogs(prev => [newFood, ...prev]);
    if (db) {
      try {
        await addDoc(collection(db, "nutrition_logs"), {
          name: newFood.name,
          portion: newFood.portion,
          servings: 1,
          calories: newFood.calories,
          protein: newFood.protein,
          logDate: todayKey,
          createdAt: new Date().toISOString()
        });
      } catch {}
    }
    setCustomFoodName(""); setCustomFoodPortion(""); setCustomFoodCals(""); setCustomFoodProt("");
  };

  const handleDeleteFood = async (id: string) => {
    setAllFoodLogs(prev => prev.filter(item => item.id !== id));
    if (db) {
      try { await deleteDoc(doc(db, "nutrition_logs", id)); } catch {}
    }
  };

  const handleManualRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const km = parseFloat(runDistance) || 0;
    const duration = parseFloat(runDuration) || 0;
    const hr = parseInt(avgHeartRate) || 135;
    if (!km || !duration) return;

    const calculatedStrain = parseFloat((km * Math.pow(hr / 100, 2) * 1.2).toFixed(1));
    const newRun: RunItem = {
      id: Date.now().toString(),
      distanceKm: km,
      durationMin: duration,
      avgHr: hr,
      strain: calculatedStrain,
      date: new Date().toLocaleDateString("en-US", { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      logDate: todayKey
    };

    setAllRuns(prev => [newRun, ...prev]);
    if (db) {
      try {
        await addDoc(collection(db, "run_logs"), {
          distanceKm: km,
          durationMin: duration,
          avgHr: hr,
          strain: calculatedStrain,
          date: newRun.date,
          logDate: todayKey,
          weightKg: parseFloat(bodyWeight) || 0,
          createdAt: new Date().toISOString(),
        });
        setStatusMessage("SAVED TO CLOUD.");
      } catch {
        setStatusMessage("SAVED LOCALLY.");
      }
    }
    setRunDistance(""); setRunDuration(""); setAvgHeartRate(""); setBodyWeight("");
    setTimeout(() => setStatusMessage(""), 3000);
  };

  const handleDeleteRun = async (id: string) => {
    setAllRuns(prev => prev.filter(item => item.id !== id));
    if (db) {
      try { await deleteDoc(doc(db, "run_logs", id)); } catch {}
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F0EA] p-4 md:p-8 selection:bg-[#FFE600] selection:text-black font-mono">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-4 border-black pb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="bg-[#FFE600] border-2 border-black p-2 brutal-shadow-sm font-black text-2xl tracking-tighter flex items-center gap-2">
              <Flame className="w-6 h-6 text-black" /> KINETIQ
            </div>
            <span className="bg-[#00FFA3] border-2 border-black px-2 py-0.5 text-xs font-bold uppercase tracking-wider brutal-shadow-sm flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> {todayKey}
            </span>
          </div>
          <p className="text-xs uppercase font-bold tracking-widest mt-2 text-zinc-700">
            ADAPTIVE HUMAN PERFORMANCE & METABOLIC ENGINE
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button onClick={() => setActiveTab("overview")} className={`px-3 py-2 sm:px-4 sm:py-2 border-2 border-black font-black uppercase text-xs sm:text-sm brutal-shadow-sm brutal-btn-active ${activeTab === "overview" ? "bg-[#FF5C00] text-white" : "bg-white text-black"}`}>Dashboard</button>
          <button onClick={() => setActiveTab("recovery")} className={`px-3 py-2 sm:px-4 sm:py-2 border-2 border-black font-black uppercase text-xs sm:text-sm brutal-shadow-sm brutal-btn-active flex items-center gap-1.5 ${activeTab === "recovery" ? "bg-[#00FFA3] text-black" : "bg-white text-black"}`}><ShieldCheck className="w-4 h-4" /> Recovery</button>
          <button onClick={() => setActiveTab("nutrition")} className={`px-3 py-2 sm:px-4 sm:py-2 border-2 border-black font-black uppercase text-xs sm:text-sm brutal-shadow-sm brutal-btn-active flex items-center gap-1.5 ${activeTab === "nutrition" ? "bg-[#FFE600] text-black" : "bg-white text-black"}`}><UtensilsCrossed className="w-4 h-4" /> Macros</button>
          <button onClick={() => setActiveTab("workouts")} className={`px-3 py-2 sm:px-4 sm:py-2 border-2 border-black font-black uppercase text-xs sm:text-sm brutal-shadow-sm brutal-btn-active flex items-center gap-1.5 ${activeTab === "workouts" ? "bg-[#FF5C00] text-white" : "bg-white text-black"}`}><Dumbbell className="w-4 h-4" /> Workouts</button>
          <button onClick={() => setActiveTab("run")} className={`px-3 py-2 sm:px-4 sm:py-2 border-2 border-black font-black uppercase text-xs sm:text-sm brutal-shadow-sm brutal-btn-active flex items-center gap-1.5 ${activeTab === "run" ? "bg-[#00FFA3] text-black" : "bg-white text-black"}`}><Footprints className="w-4 h-4" /> Run</button>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto space-y-8">
        {/* Banner */}
        <section className="bg-[#FFE600] border-4 border-black p-6 brutal-shadow-lg">
          <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6">
            <div className="space-y-2 max-w-3xl">
              <div className="inline-flex items-center gap-2 bg-black text-white px-3 py-1 text-xs font-black uppercase tracking-widest">
                <Sparkles className="w-4 h-4 text-[#FFE600]" /> Today's Adaptive Blueprint
              </div>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight leading-none">
                {combinedTotalStrain > OPTIMAL_STRAIN_LIMIT 
                  ? "HIGH STRAIN DETECTED: FOCUS ON RECOVERY" 
                  : "HYPERTROPHY + AEROBIC ADAPTIVE WINDOW OPEN"}
              </h2>
              <p className="text-sm font-bold leading-relaxed text-black/90">
                Combined daily strain: <strong className="underline decoration-2">{combinedTotalStrain} / {OPTIMAL_STRAIN_LIMIT}</strong> (Lifting: {totalWorkoutStrain.toFixed(1)} | Run: {totalRunStrain.toFixed(1)}). Status: <strong className="underline decoration-2">{recoveryState}</strong>.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-white border-2 border-black p-3 brutal-shadow-sm text-center">
                <span className="block text-[10px] font-black uppercase text-zinc-500">Run Strain</span>
                <span className="text-lg font-black text-[#FF5C00]">{totalRunStrain.toFixed(1)}</span>
              </div>
              <div className="bg-[#00FFA3] border-2 border-black p-3 brutal-shadow-sm text-center">
                <span className="block text-[10px] font-black uppercase text-black">Lift Strain</span>
                <span className="text-lg font-black">{totalWorkoutStrain.toFixed(1)}</span>
              </div>
              <div className="bg-white border-2 border-black p-3 brutal-shadow-sm text-center col-span-2 sm:col-span-1">
                <span className="block text-[10px] font-black uppercase text-zinc-500">Total Strain</span>
                <span className="text-lg font-black">{combinedTotalStrain}</span>
              </div>
            </div>
          </div>
        </section>

        {/* TAB 1: RECOVERY COMMAND CENTER */}
        {activeTab === "recovery" && (
          <div className="space-y-8">
            {/* Run Diagnosis Trigger Card */}
            <div className="bg-white border-4 border-black p-6 brutal-shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 bg-black text-[#00FFA3] px-2.5 py-0.5 text-xs font-black uppercase">
                  <ShieldCheck className="w-3.5 h-3.5" /> Neural Recovery Core
                </div>
                <h3 className="text-xl font-black uppercase mt-1">Adaptive Recovery Diagnosis</h3>
                <p className="text-xs font-bold text-zinc-600 uppercase">
                  Synthesizes daily strain ({combinedTotalStrain}), protein intake ({totalProteinConsumed}g), and resting HR ({RESTING_HR_BASELINE} BPM)
                </p>
              </div>

              <button
                onClick={handleRunDiagnosis}
                disabled={mlLoading}
                className="bg-[#00FFA3] text-black border-2 border-black px-7 py-3.5 font-black uppercase tracking-wider text-sm brutal-shadow brutal-btn-active flex items-center gap-2"
              >
                {mlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {mlLoading ? "Computing Analysis..." : "Compute Recovery Diagnosis"}
              </button>
            </div>

            {mlError && (
              <div className="bg-red-200 border-4 border-black p-4 brutal-shadow font-black text-xs uppercase text-red-800">
                {mlError}
              </div>
            )}

            {/* Diagnosis Output Card */}
            {mlPlan && (
              <section className="bg-[#FFE600] border-4 border-black p-6 md:p-8 brutal-shadow-lg space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-2 border-black pb-4">
                  <div>
                    <span className="text-xs font-black uppercase bg-black text-white px-2 py-0.5 inline-block">
                      Readiness Score: {mlPlan.readinessScore} / 100
                    </span>
                    <h3 className="text-2xl md:text-3xl font-black uppercase mt-2">
                      Nitrogen Balance: {mlPlan.nitrogenBalanceStatus}
                    </h3>
                  </div>
                  <div className="bg-white border-2 border-black px-4 py-2 brutal-shadow-sm font-black text-xs uppercase">
                    Target Sleep: {mlPlan.sleepTargetHours}h | Hydration: {mlPlan.hydrationLiters}L
                  </div>
                </div>

                <div className="bg-white border-2 border-black p-4 brutal-shadow-sm space-y-2">
                  <span className="text-[10px] font-black uppercase text-zinc-500">Physiological Synthesis</span>
                  <p className="font-bold text-sm leading-relaxed text-black">{mlPlan.overallAssessment}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white border-2 border-black p-4 brutal-shadow-sm space-y-1.5">
                    <span className="text-[10px] font-black uppercase text-[#FF5C00]">Nutritional Adjustment</span>
                    <p className="font-bold text-xs leading-relaxed">{mlPlan.nutritionAdvice}</p>
                  </div>
                  <div className="bg-white border-2 border-black p-4 brutal-shadow-sm space-y-1.5">
                    <span className="text-[10px] font-black uppercase text-black">Tomorrow's Training Protocol</span>
                    <p className="font-bold text-xs leading-relaxed">{mlPlan.trainingGuidanceTomorrow}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-wider block">Prescribed Action Items:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {mlPlan.actionItems.map((item, idx) => (
                      <div key={idx} className="bg-white border-2 border-black p-3 text-xs font-black uppercase flex items-center gap-2 brutal-shadow-sm">
                        <ArrowRight className="w-4 h-4 text-[#FF5C00] shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Diagnostic Indicator Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className={`border-4 border-black p-6 brutal-shadow ${combinedTotalStrain > OPTIMAL_STRAIN_LIMIT ? "bg-red-200" : "bg-white"}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-black uppercase text-zinc-600">Recovery Status</span>
                    <h3 className="text-2xl font-black uppercase mt-1">{recoveryState}</h3>
                  </div>
                  {combinedTotalStrain > OPTIMAL_STRAIN_LIMIT ? <AlertTriangle className="w-8 h-8 text-red-600" /> : <CheckCircle2 className="w-8 h-8 text-[#00FFA3]" />}
                </div>
                <p className="text-xs font-bold text-zinc-700 mt-4 leading-relaxed">
                  {combinedTotalStrain > OPTIMAL_STRAIN_LIMIT 
                    ? "Strain threshold exceeded! Elevated risk of catabolism and nervous system fatigue." 
                    : "Training load is within optimal physiological limits for muscular and mitochondrial recovery."}
                </p>
              </div>

              <div className="bg-white border-4 border-black p-6 brutal-shadow">
                <span className="text-xs font-black uppercase text-zinc-600">Strain Ceiling Capacity</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black">{combinedTotalStrain}</span>
                  <span className="text-sm font-bold uppercase text-zinc-500">/ {OPTIMAL_STRAIN_LIMIT} MAX</span>
                </div>
                <div className="w-full bg-[#F4F0EA] border-2 border-black h-6 p-0.5 mt-3">
                  <div className={`h-full border border-black transition-all duration-300 ${combinedTotalStrain > OPTIMAL_STRAIN_LIMIT ? "bg-red-500" : "bg-[#00FFA3]"}`} style={{ width: `${Math.min(100, strainPercentage)}%` }} />
                </div>
                <span className="block text-[10px] font-black uppercase mt-2 text-zinc-600">{strainPercentage.toFixed(0)}% OF TOTAL CAPACITY UTILIZED</span>
              </div>

              <div className="bg-white border-4 border-black p-6 brutal-shadow">
                <span className="text-xs font-black uppercase text-zinc-600">Resting HR Diagnostic</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black">{RESTING_HR_BASELINE}</span>
                  <span className="text-sm font-bold uppercase text-zinc-500">BPM</span>
                </div>
                <div className="bg-[#FFE600] border-2 border-black p-2 brutal-shadow-sm mt-3 text-center">
                  <span className="text-xs font-black uppercase">Parasympathetic Homeostasis</span>
                </div>
                <span className="block text-[10px] font-black uppercase mt-2 text-zinc-600">Optimal autonomic nervous balance</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RUN */}
        {activeTab === "run" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <section className="lg:col-span-5 bg-white border-4 border-black p-6 md:p-8 brutal-shadow-lg space-y-6">
              <div className="border-b-2 border-black pb-4">
                <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2"><Footprints className="w-6 h-6 text-[#FF5C00]" /> Record Running Session</h3>
                <p className="text-xs font-bold text-zinc-600 uppercase">Run Strain = Distance × (AvgHR / 100)² × 1.2</p>
              </div>

              <form onSubmit={handleManualRunSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Run Distance (KM)</label>
                  <input type="number" step="0.01" placeholder="e.g. 8.4" value={runDistance} onChange={(e) => setRunDistance(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Duration (Minutes)</label>
                  <input type="number" placeholder="e.g. 45" value={runDuration} onChange={(e) => setRunDuration(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Average Heart Rate (BPM)</label>
                  <input type="number" placeholder="e.g. 142" value={avgHeartRate} onChange={(e) => setAvgHeartRate(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Scale Weight (KG)</label>
                  <input type="number" step="0.1" placeholder="e.g. 77.4" value={bodyWeight} onChange={(e) => setBodyWeight(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                </div>

                <button type="submit" className="w-full bg-[#FF5C00] text-white border-2 border-black p-4 font-black uppercase tracking-wider text-base brutal-shadow brutal-btn-active mt-2">
                  Commit Run & Save to Cloud
                </button>
                {statusMessage && <div className="mt-3 text-center font-black text-xs uppercase bg-[#00FFA3] p-2 border-2 border-black">{statusMessage}</div>}
              </form>
            </section>

            <section className="lg:col-span-7 bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
              <div className="flex justify-between items-center pb-4 border-b-2 border-black">
                <div className="flex items-center gap-2"><Layers className="w-6 h-6 text-black" /><h3 className="text-xl font-black uppercase tracking-tight">Today's Running Sessions</h3></div>
                <div className="bg-[#00FFA3] text-black border-2 border-black px-3 py-1 text-xs font-black uppercase brutal-shadow-sm">Total: {totalRunKm.toFixed(1)} KM</div>
              </div>

              {loggedRuns.length === 0 ? (
                <div className="p-12 text-center bg-[#F4F0EA] border-2 border-dashed border-black font-black uppercase text-xs text-zinc-500">No runs logged for today ({todayKey}).</div>
              ) : (
                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                  {loggedRuns.map((run) => (
                    <div key={run.id} className="bg-[#F4F0EA] border-2 border-black p-4 brutal-shadow-sm flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-2"><h4 className="font-black text-base uppercase">{run.distanceKm} KM RUN</h4><span className="text-[10px] font-bold bg-zinc-200 border border-black px-1.5 py-0.5 uppercase">{run.date}</span></div>
                        <div className="flex items-center gap-2 mt-1 text-xs font-bold text-zinc-700 uppercase"><span>{run.durationMin} MINS</span><span>•</span><span>{run.avgHr} AVG BPM</span></div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-sm bg-[#FF5C00] text-white border border-black px-2 py-0.5">{run.strain}</span>
                        <button onClick={() => handleDeleteRun(run.id)} className="p-2 bg-white border border-black brutal-shadow-sm brutal-btn-active text-black hover:bg-red-500 hover:text-white"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 3: WORKOUTS */}
        {activeTab === "workouts" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <section className="lg:col-span-5 bg-white border-4 border-black p-6 brutal-shadow-lg space-y-6">
              <div className="border-b-2 border-black pb-4">
                <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2"><Dumbbell className="w-6 h-6 text-[#FF5C00]" /> Log Workout Set</h3>
                <p className="text-xs font-bold text-zinc-600 uppercase">Strain = (Sets × Reps × Weight) / 100</p>
              </div>

              <form onSubmit={handleAddWorkout} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Select Preset Exercise</label>
                  <select value={selectedExercise} onChange={(e) => setSelectedExercise(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]">
                    {PRESET_EXERCISES.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase">Or Custom Exercise</label>
                  <input type="text" placeholder="e.g. Incline Dumbbell Curl" value={customExercise} onChange={(e) => setCustomExercise(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase">Sets</label>
                    <input type="number" placeholder="4" min="1" value={sets} onChange={(e) => setSets(e.target.value === "" ? "" : Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase">Reps</label>
                    <input type="number" placeholder="10" min="1" value={reps} onChange={(e) => setReps(e.target.value === "" ? "" : Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase">Weight (KG)</label>
                    <input type="number" step="0.5" placeholder="80" value={weight} onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                  </div>
                </div>

                <button type="submit" className="w-full bg-[#00FFA3] text-black border-2 border-black p-3.5 font-black uppercase tracking-wider text-sm brutal-shadow brutal-btn-active">+ Add & Save to Cloud</button>
              </form>
            </section>

            <section className="lg:col-span-7 bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
              <div className="flex justify-between items-center pb-4 border-b-2 border-black">
                <div className="flex items-center gap-2"><Layers className="w-6 h-6 text-black" /><h3 className="text-xl font-black uppercase tracking-tight">Today's Workout Log</h3></div>
                <div className="bg-[#FF5C00] text-white border-2 border-black px-3 py-1 text-xs font-black uppercase brutal-shadow-sm">Lifting Strain: {totalWorkoutStrain.toFixed(1)}</div>
              </div>

              {workoutList.length === 0 ? (
                <div className="p-12 text-center bg-[#F4F0EA] border-2 border-dashed border-black font-black uppercase text-xs text-zinc-500">No workouts recorded for today ({todayKey}).</div>
              ) : (
                <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
                  {workoutList.map((item) => (
                    <div key={item.id} className="bg-[#F4F0EA] border-2 border-black p-4 brutal-shadow-sm flex justify-between items-center">
                      <div>
                        <h4 className="font-black text-sm uppercase">{item.name}</h4>
                        <div className="flex items-center gap-2 mt-1 text-xs font-bold text-zinc-700 uppercase"><span>{item.sets} Sets</span><span>•</span><span>{item.reps} Reps</span><span>•</span><span>{item.weight} KG</span></div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-sm bg-[#FFE600] border border-black px-2 py-0.5">{item.strain}</span>
                        <button onClick={() => handleDeleteWorkout(item.id)} className="p-2 bg-white border border-black brutal-shadow-sm brutal-btn-active text-black hover:bg-red-500 hover:text-white"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: MACROS */}
        {activeTab === "nutrition" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 bg-white border-4 border-black p-3 brutal-shadow">
              <button onClick={() => setNutritionSubTab("add")} className={`px-5 py-2.5 font-black uppercase text-sm border-2 border-black brutal-shadow-sm brutal-btn-active flex items-center gap-2 ${nutritionSubTab === "add" ? "bg-[#FFE600] text-black" : "bg-[#F4F0EA] text-zinc-600"}`}><Plus className="w-4 h-4" /> 1. Add Food (Today)</button>
              <button onClick={() => setNutritionSubTab("history")} className={`px-5 py-2.5 font-black uppercase text-sm border-2 border-black brutal-shadow-sm brutal-btn-active flex items-center gap-2 ${nutritionSubTab === "history" ? "bg-[#00FFA3] text-black" : "bg-[#F4F0EA] text-zinc-600"}`}><Clock className="w-4 h-4" /> 2. Food History by Date</button>
            </div>

            {nutritionSubTab === "add" && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white border-4 border-black p-6 brutal-shadow">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-[#FF5C00]" /><span className="font-black uppercase text-sm">Protein Progress</span></div>
                      <span className="font-black text-sm">{totalProteinConsumed}g / {PROTEIN_TARGET}g</span>
                    </div>
                    <div className="w-full bg-[#F4F0EA] border-2 border-black h-6 p-0.5">
                      <div className="bg-[#00FFA3] h-full border border-black transition-all duration-300" style={{ width: `${Math.min(100, (totalProteinConsumed / PROTEIN_TARGET) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] font-bold text-zinc-600 uppercase mt-2">{((totalProteinConsumed / PROTEIN_TARGET) * 100).toFixed(0)}% of daily target reached</p>
                  </div>

                  <div className="bg-white border-4 border-black p-6 brutal-shadow">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2"><Flame className="w-5 h-5 text-[#FF5C00]" /><span className="font-black uppercase text-sm">Calories Consumed</span></div>
                      <span className="font-black text-sm">{totalCaloriesConsumed} / {CALORIE_TARGET} kcal</span>
                    </div>
                    <div className="w-full bg-[#F4F0EA] border-2 border-black h-6 p-0.5">
                      <div className="bg-[#FFE600] h-full border border-black transition-all duration-300" style={{ width: `${Math.min(100, (totalCaloriesConsumed / CALORIE_TARGET) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] font-bold text-zinc-600 uppercase mt-2">{CALORIE_TARGET - totalCaloriesConsumed >= 0 ? `${CALORIE_TARGET - totalCaloriesConsumed} kcal remaining` : `${Math.abs(CALORIE_TARGET - totalCaloriesConsumed)} kcal over target`}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-6 space-y-6">
                    <section className="bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
                      <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2"><UtensilsCrossed className="w-5 h-5" /> Select From Food Database</h3>
                      <form onSubmit={handleAddDropdownFood} className="space-y-3">
                        <select value={selectedFoodIndex} onChange={(e) => setSelectedFoodIndex(Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-3 font-bold text-xs md:text-sm brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]">
                          {FOOD_DATABASE.map((item, idx) => (
                            <option key={idx} value={idx}>{item.name} ({item.portion}) — ~{item.calories} kcal | ~{item.protein}g P</option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                          <input type="number" step="0.1" min="0.1" value={presetServings} onChange={(e) => setPresetServings(Math.max(0.1, parseFloat(e.target.value) || 1))} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none" />
                          <div className="bg-[#FFE600] border-2 border-black p-2 brutal-shadow-sm flex flex-col justify-center text-center font-black text-xs">
                            {Math.round(FOOD_DATABASE[selectedFoodIndex].calories * presetServings)} kcal | {(FOOD_DATABASE[selectedFoodIndex].protein * presetServings).toFixed(1)}g P
                          </div>
                        </div>
                        <button type="submit" className="w-full bg-[#00FFA3] text-black border-2 border-black p-3 font-black uppercase tracking-wider text-xs brutal-shadow brutal-btn-active flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Add Selected Food</button>
                      </form>
                    </section>

                    <section className="bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
                      <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-2"><Search className="w-5 h-5 text-black" /> Type & Search Food</h3>
                      <input type="text" placeholder="Type name (e.g. Biryani, Paneer, Whey)..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                      {searchQuery.trim() && (
                        <div className="border-2 border-black bg-[#F4F0EA] max-h-56 overflow-y-auto divide-y-2 divide-black brutal-shadow-sm">
                          {filteredFoods.map((item, idx) => (
                            <div key={idx} className="p-3 flex justify-between items-center hover:bg-[#FFE600]">
                              <div><h5 className="font-black text-xs uppercase">{item.name}</h5><p className="text-[11px] font-bold text-zinc-600 uppercase">{item.portion} • ~{item.calories} kcal • ~{item.protein}g P</p></div>
                              <button onClick={() => handleAddSearchedFood(item)} className="bg-[#00FFA3] text-black border-2 border-black px-3 py-1 font-black text-xs uppercase brutal-shadow-sm brutal-btn-active">+ Add</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
                      <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-2"><Plus className="w-5 h-5" /> Add Custom Food / Snack</h3>
                      <form onSubmit={handleAddCustomFood} className="space-y-3">
                        <input type="text" placeholder="Food Name" value={customFoodName} onChange={(e) => setCustomFoodName(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none focus:bg-[#FFE600]" />
                        <div className="grid grid-cols-3 gap-2">
                          <input type="text" placeholder="Portion" value={customFoodPortion} onChange={(e) => setCustomFoodPortion(e.target.value)} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none" />
                          <input type="number" placeholder="Calories" value={customFoodCals} onChange={(e) => setCustomFoodCals(e.target.value === "" ? "" : Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none" />
                          <input type="number" step="0.1" placeholder="Protein (g)" value={customFoodProt} onChange={(e) => setCustomFoodProt(e.target.value === "" ? "" : Number(e.target.value))} className="w-full bg-[#F4F0EA] border-2 border-black p-2.5 font-bold text-sm brutal-shadow-sm focus:outline-none" />
                        </div>
                        <button type="submit" className="w-full bg-black text-white border-2 border-black p-3 font-black uppercase tracking-wider text-xs brutal-shadow brutal-btn-active mt-2">+ Save Custom Item</button>
                      </form>
                    </section>
                  </div>

                  <section className="lg:col-span-6 bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
                    <div className="flex justify-between items-center pb-4 border-b-2 border-black">
                      <div className="flex items-center gap-2"><Layers className="w-6 h-6 text-black" /><h3 className="text-xl font-black uppercase tracking-tight">Today's Consumed Foods</h3></div>
                      <div className="bg-[#FFE600] text-black border-2 border-black px-3 py-1 text-xs font-black uppercase brutal-shadow-sm">{loggedFoods.length} Logged</div>
                    </div>

                    {loggedFoods.length === 0 ? (
                      <div className="p-12 text-center bg-[#F4F0EA] border-2 border-dashed border-black font-black uppercase text-xs text-zinc-500">No meals logged for today ({todayKey}).</div>
                    ) : (
                      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                        {loggedFoods.map((item) => (
                          <div key={item.id} className="bg-[#F4F0EA] border-2 border-black p-4 brutal-shadow-sm flex justify-between items-center">
                            <div>
                              <h4 className="font-black text-sm uppercase">{item.name}</h4>
                              <div className="flex items-center gap-2 mt-1 text-xs font-bold text-zinc-700 uppercase"><span>{item.portion}</span>{item.servings !== 1 && <span>({item.servings}x)</span>}<span>•</span><span className="text-[#FF5C00] font-black">{item.calories} kcal</span></div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-black text-sm bg-[#00FFA3] border border-black px-2 py-0.5">{item.protein}g</span>
                              <button onClick={() => handleDeleteFood(item.id)} className="p-2 bg-white border border-black brutal-shadow-sm brutal-btn-active text-black hover:bg-red-500 hover:text-white"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {/* OPTION 2: FOOD HISTORY (NEO-BRUTALIST GRAPH) */}
            {nutritionSubTab === "history" && (
              <div className="space-y-8">
                <section className="bg-white border-4 border-black p-6 md:p-8 brutal-shadow-lg space-y-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-2 border-black pb-4">
                    <div>
                      <span className="text-[11px] uppercase tracking-widest font-black text-black bg-[#FFE600] px-2 py-0.5 border border-black inline-block">
                        Weekly Nutrition Distribution
                      </span>
                      <h3 className="text-2xl font-black uppercase text-black mt-2">
                        {historyMetric === "protein" ? "Protein Distribution (g)" : "Calorie Distribution (kcal)"}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex bg-[#F4F0EA] p-1 border-2 border-black brutal-shadow-sm">
                        <button onClick={() => setHistoryMetric("protein")} className={`px-3 py-1 text-xs font-black uppercase transition-colors ${historyMetric === "protein" ? "bg-[#00FFA3] text-black border border-black" : "text-black hover:bg-[#FFE600]"}`}>Protein (g)</button>
                        <button onClick={() => setHistoryMetric("calories")} className={`px-3 py-1 text-xs font-black uppercase transition-colors ${historyMetric === "calories" ? "bg-[#FF5C00] text-white border border-black" : "text-black hover:bg-[#FFE600]"}`}>Calories (kcal)</button>
                      </div>

                      <input type="date" value={selectedHistoryDate} onChange={(e) => setSelectedHistoryDate(e.target.value)} className="bg-[#FFE600] text-black border-2 border-black p-1.5 font-black text-xs brutal-shadow-sm focus:outline-none" />
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={historyWeeklyChartData} margin={{ top: 20, right: 30, left: -20, bottom: 0 }} onClick={(e: any) => { if (e?.activePayload && e.activePayload[0]?.payload?.fullDate) setSelectedHistoryDate(e.activePayload[0].payload.fullDate); }}>
                        <defs>
                          <pattern id="brutalDiagonalHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                            <line x1="0" y1="0" x2="0" y2="8" stroke="#000" strokeWidth="2" opacity="0.15" />
                          </pattern>
                        </defs>

                        <XAxis dataKey="day" stroke="#000" tick={{ fill: '#000', fontSize: 13, fontWeight: 'bold' }} tickLine={false} axisLine={{ stroke: '#000', strokeWidth: 2 }} />
                        <YAxis stroke="#000" tick={{ fill: '#000', fontSize: 11, fontWeight: 'bold' }} tickLine={false} axisLine={{ stroke: '#000', strokeWidth: 2 }} domain={[0, historyMetric === "protein" ? 220 : 3000]} />
                        <Tooltip contentStyle={{ backgroundColor: '#FFE600', border: '2px solid black', color: '#000', fontWeight: 'bold', fontSize: 12 }} labelFormatter={(_: any, payload: any) => payload[0]?.payload?.fullDate || ""} />
                        <ReferenceLine y={historyMetric === "protein" ? PROTEIN_TARGET : CALORIE_TARGET} stroke="#000" strokeDasharray="4 4" strokeWidth={2} label={{ value: 'Avg Target', fill: '#000', fontSize: 11, fontWeight: 'bold', position: 'right' }} />
                        <Area type="monotone" dataKey={historyMetric === "protein" ? "proteinAvg" : "caloriesAvg"} stroke="#000" strokeWidth={2} fill="url(#brutalDiagonalHatch)" />
                        <Bar dataKey={historyMetric === "protein" ? "protein" : "calories"} fill={historyMetric === "protein" ? "#00FFA3" : "#FF5C00"} stroke="#000" strokeWidth={2} barSize={18} radius={[6, 6, 0, 0]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 pt-2 border-t-2 border-black text-xs font-black uppercase">
                    <div className="flex items-center gap-2">
                      <span className={`w-3.5 h-3.5 border border-black inline-block ${historyMetric === "protein" ? "bg-[#00FFA3]" : "bg-[#FF5C00]"}`} />
                      <span className="text-black">{historyMetric === "protein" ? "Daily Protein Intake (g)" : "Daily Caloric Intake (kcal)"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-3.5 border border-black bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px] opacity-75 inline-block" />
                      <span className="text-zinc-600">Weekly Moving Average Profile</span>
                    </div>
                  </div>
                </section>

                {/* Day Summary Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#FFE600] border-4 border-black p-6 brutal-shadow">
                    <span className="text-xs font-black uppercase text-black">Selected Record Date</span>
                    <h3 className="text-2xl font-black uppercase mt-1">{selectedHistoryDate}</h3>
                    <span className="text-[10px] font-bold bg-black text-white px-2 py-0.5 inline-block mt-2 uppercase">{selectedHistoryDate === todayKey ? "Today's Live Record" : "Archived Record"}</span>
                  </div>

                  <div className="bg-white border-4 border-black p-6 brutal-shadow">
                    <div className="flex justify-between items-center"><span className="text-xs font-black uppercase text-zinc-500">Calories on Day</span><Flame className="w-5 h-5 text-[#FF5C00]" /></div>
                    <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{historyDayCalories}</span><span className="text-xs font-bold uppercase">/ {CALORIE_TARGET} kcal</span></div>
                  </div>

                  <div className="bg-white border-4 border-black p-6 brutal-shadow">
                    <div className="flex justify-between items-center"><span className="text-xs font-black uppercase text-zinc-500">Protein on Day</span><Zap className="w-5 h-5 text-[#00FFA3]" /></div>
                    <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{historyDayProtein}</span><span className="text-xs font-bold uppercase">/ {PROTEIN_TARGET}g</span></div>
                  </div>
                </div>

                {/* Historical Food List */}
                <section className="bg-white border-4 border-black p-6 brutal-shadow-lg space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-black">
                    <div className="flex items-center gap-2"><History className="w-6 h-6 text-black" /><h3 className="text-xl font-black uppercase">Meals Eaten on {selectedHistoryDate}</h3></div>
                    <div className="bg-[#00FFA3] text-black border-2 border-black px-3 py-1 text-xs font-black uppercase brutal-shadow-sm">{historyDayFoods.length} Items Logged</div>
                  </div>

                  {historyDayFoods.length === 0 ? (
                    <div className="p-16 text-center bg-[#F4F0EA] border-2 border-dashed border-black font-black uppercase text-xs text-zinc-500">No food records found for {selectedHistoryDate}.</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {historyDayFoods.map((item) => (
                        <div key={item.id} className="bg-[#F4F0EA] border-2 border-black p-4 brutal-shadow-sm flex justify-between items-center">
                          <div>
                            <h4 className="font-black text-sm uppercase">{item.name}</h4>
                            <div className="flex items-center gap-2 mt-1 text-xs font-bold text-zinc-700 uppercase"><span>{item.portion}</span>{item.servings !== 1 && <span>({item.servings}x)</span>}<span>•</span><span className="text-[#FF5C00] font-black">{item.calories} kcal</span></div>
                          </div>
                          <span className="font-black text-sm bg-[#00FFA3] border border-black px-2 py-0.5">{item.protein}g</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: OVERVIEW */}
        {activeTab === "overview" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border-3 border-black p-4 brutal-shadow-sm">
                <div className="flex justify-between items-start"><span className="text-xs font-black uppercase text-zinc-500">Today's Run</span><Footprints className="w-5 h-5 text-[#FF5C00]" /></div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{totalRunKm.toFixed(1)}</span><span className="text-xs font-bold uppercase">KM</span></div>
              </div>
              <div className="bg-white border-3 border-black p-4 brutal-shadow-sm">
                <div className="flex justify-between items-start"><span className="text-xs font-black uppercase text-zinc-500">Combined Strain</span><Dumbbell className="w-5 h-5 text-black" /></div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{combinedTotalStrain}</span><span className="text-xs font-bold uppercase">/ {OPTIMAL_STRAIN_LIMIT}</span></div>
              </div>
              <div className="bg-white border-3 border-black p-4 brutal-shadow-sm">
                <div className="flex justify-between items-start"><span className="text-xs font-black uppercase text-zinc-500">Protein Hit</span><Zap className="w-5 h-5 text-[#00FFA3]" /></div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{totalProteinConsumed}</span><span className="text-xs font-bold uppercase">/ {PROTEIN_TARGET}g</span></div>
              </div>
              <div className="bg-white border-3 border-black p-4 brutal-shadow-sm">
                <div className="flex justify-between items-start"><span className="text-xs font-black uppercase text-zinc-500">Resting HR</span><HeartPulse className="w-5 h-5 text-[#FF5C00]" /></div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-black">{RESTING_HR_BASELINE}</span><span className="text-xs font-bold uppercase">BPM</span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white border-4 border-black p-6 brutal-shadow">
                <div className="flex justify-between items-center mb-4 border-b-2 border-black pb-2">
                  <h3 className="font-black uppercase text-sm tracking-wide flex items-center gap-2"><Activity className="w-4 h-4 text-[#FF5C00]" /> Running Volume Distribution</h3>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={runChartData}>
                      <XAxis dataKey="day" stroke="#000" tick={{ fill: '#000', fontSize: 12, fontWeight: 'bold' }} />
                      <YAxis stroke="#000" tick={{ fill: '#000', fontSize: 12, fontWeight: 'bold' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#FFE600', border: '2px solid black', fontWeight: 'bold' }} />
                      <Bar dataKey="km" fill="#FF5C00" stroke="#000" strokeWidth={2} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white border-4 border-black p-6 brutal-shadow">
                <div className="flex justify-between items-center mb-4 border-b-2 border-black pb-2">
                  <h3 className="font-black uppercase text-sm tracking-wide flex items-center gap-2"><Dumbbell className="w-4 h-4" /> Recomposition Trajectory</h3>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={STATIC_RECOMP}>
                      <XAxis dataKey="day" stroke="#000" tick={{ fill: '#000', fontSize: 12, fontWeight: 'bold' }} />
                      <YAxis stroke="#000" tick={{ fill: '#000', fontSize: 12, fontWeight: 'bold' }} domain={['dataMin - 1', 'dataMax + 1']} />
                      <Tooltip contentStyle={{ backgroundColor: '#00FFA3', border: '2px solid black', fontWeight: 'bold' }} />
                      <Area type="monotone" dataKey="weight" stroke="#000" strokeWidth={3} fill="#FFE600" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}