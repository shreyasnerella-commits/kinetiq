# KINETIQ — Adaptive Human Performance & Metabolic Engine


KINETIQ is a high-performance, web-based athletic telemetry and metabolic tracking dashboard engineered with a high-contrast **neo-brutalist** design. It combines client-side deep learning for autonomic recovery diagnosis, universal `.gpx` file parsing, dynamic goal-calibrated macronutrient modeling, and user-isolated cloud storage.

##  Key Features

* **In-Browser Recovery Neural Network**: Uses an in-browser Multilayer Perceptron (MLP) built with **TensorFlow.js** and trained on the WHOOP dataset to output readiness scores, target sleep requirements, hydration demands, and nitrogen balance diagnostics.
* **IndexedDB Model Caching**: Saves and retrieves compiled model weights locally (`indexeddb://kinetiq_whoop_model_v1`) to eliminate cold starts and server inference costs.
* **Universal Activity File Ingestion (`.gpx`)**: Drag-and-drop GPX parser computing cumulative distance via the Haversine formula and elapsed moving time in-browser—bypassing paid third-party wearable APIs.
* **Dynamic Goal & Macro Engine**: Computes daily caloric baselines and protein synthesis targets (1.8–2.2 g/kg) based on user-calibrated body mass and target objectives (Cut, Maintain, Bulk).
* **Multi-Domain Strain Aggregator**: Tracks cardiovascular exertion across resistance training and running volume against optimal systemic thresholds.
* **Per-User Siloed Storage**: Backed by Firebase Authentication and Firestore queries scoped strictly to active user sessions (`userId == currentUser.uid`).
* **Adaptive Neo-Brutalist Interface**: Built with Tailwind CSS, custom sharp brutal-shadow styling, collapsible drawer navigation, and light/dark theme persistence.

---

##  Tech Stack
| **Frontend Core** - React 18, TypeScript, Vite 
| **Styling & UI** - Tailwind CSS, Lucide React (Icons), Custom Neo-Brutalist Theme 
| **Telemetry & Visuals** - Recharts (Composed, Area, Bar, ReferenceLine charts) 
| **Machine Learning** - TensorFlow.js, PapaParse (Client-Side CSV ETL) 
| **Database & Auth** - Firebase Authentication (Email/Password), Cloud Firestore 
| **Deployment** - Vercel CI/CD 

##  Recovery ML Architecture

The diagnostics engine in `src/lib/whoopML.ts` runs a sequential deep feedforward neural network entirely in the browser:
[Normalized Inputs (5)]
├── Scaled Day Strain (0.0 - 1.0)
├── Heart Rate Exertion Index
├── Duration Factor (Max 180 min)
├── Sleep Performance Adherence
└── Protein Target Ratio
          │
          ▼
    Dense (48 units, ReLU)
          │
    Dropout (rate = 0.1)
          │
    Dense (24 units, ReLU)
          │
          ▼
   Dense (2 units, Sigmoid)
          │
          ├── Output 1: Readiness / Recovery Score (0 - 100%)
          └── Output 2: Prescribed Sleep Duration (4.0 - 10.0 hrs)