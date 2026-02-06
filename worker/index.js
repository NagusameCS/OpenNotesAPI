/**
 * OpenNotes API Gateway - Cloudflare Worker
 * 
 * This worker acts as a secure proxy to the OpenNotes API.
 * It validates app tokens and forwards requests with the real API key.
 * 
 * Environment Variables (set in Cloudflare dashboard):
 * - OPENNOTES_API_KEY: The actual API key for OpenNotes
 * - APP_TOKENS: JSON string of authorized app tokens
 * - ADMIN_TOKEN: Token for admin operations
 * - QUIZ_KV: KV namespace for quiz storage (optional, falls back to in-memory)
 * 
 * @license MIT
 */

const OPENNOTES_API = 'https://open-notes.tebby2008-li.workers.dev';

// ==================== QUIZ STORAGE ====================
// In-memory quiz store (for dev/demo; use KV in production for persistence)
const quizStore = new Map();
let quizzesSeeded = false;

// Quiz schema version for forward compatibility
const QUIZ_SCHEMA_VERSION = '1.0';

// ==================== SEED QUIZZES ====================
const SEED_QUIZZES = [
  // ----- IB Math AA HL -----
  {
    id: "math-aa-hl-algebra", schemaVersion: "1.0", title: "IB Math AA HL - Algebra & Number", subject: "math-aa-hl", topic: "Algebra and Number", difficulty: "hard",
    description: "Sequences, series, binomial theorem, and complex numbers", tags: ["ib","math","algebra","sequences","series","complex numbers"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Find the sum of the arithmetic series $\\sum_{k=1}^{20}(3k+2)$", options:["$670$","$630$","$710$","$580$"], correctAnswers:[0], explanation:"$3\\cdot\\frac{20\\cdot21}{2}+40=670$", points:1 },
      { id:"q2", type:"mcq", question:"A geometric sequence has $u_1=3$ and $r=2$. Find the smallest $n$ such that $S_n>1000$", options:["$n=8$","$n=9$","$n=7$","$n=10$"], correctAnswers:[1], explanation:"$S_n=3(2^n-1)$. $S_8=765$, $S_9=1533$. Answer: $n=9$", points:1 },
      { id:"q3", type:"mcq", question:"Express $z=-1+i\\sqrt{3}$ in polar form", options:["$2\\text{cis}\\frac{2\\pi}{3}$","$2\\text{cis}\\frac{\\pi}{3}$","$\\sqrt{2}\\text{cis}\\frac{3\\pi}{4}$","$2\\text{cis}\\frac{4\\pi}{3}$"], correctAnswers:[0], explanation:"$|z|=2$, $\\arg(z)=\\frac{2\\pi}{3}$", points:1 },
      { id:"q4", type:"mcq", question:"$(\\cos\\frac{\\pi}{6}+i\\sin\\frac{\\pi}{6})^{12}=$", options:["$1$","$-1$","$i$","$-i$"], correctAnswers:[0], explanation:"$\\text{cis}(12\\cdot\\frac{\\pi}{6})=\\text{cis}(2\\pi)=1$", points:1 },
      { id:"q5", type:"frq", question:"Find the value of $1+2+4+8+\\ldots+2^{10}$", correctAnswers:["2047"], explanation:"Geometric series: $\\frac{2^{11}-1}{1}=2047$", points:1 },
      { id:"q6", type:"mcq", question:"$S_\\infty=8$ and $a=6$. Find the common ratio $r$.", options:["$\\frac{1}{4}$","$\\frac{3}{4}$","$\\frac{1}{3}$","$\\frac{2}{3}$"], correctAnswers:[0], explanation:"$\\frac{6}{1-r}=8 \\Rightarrow r=\\frac{1}{4}$", points:1 },
      { id:"q7", type:"mcq", question:"$\\sum_{r=0}^{n}\\binom{n}{r}=2^n$ is proven by setting in $(1+x)^n$:", options:["$x=1$","$x=0$","Mathematical induction","$x=-1$"], correctAnswers:[0], explanation:"$(1+1)^n=\\sum\\binom{n}{r}=2^n$", points:1 },
      { id:"q8", type:"mcq", question:"If $z=2+3i$ and $w=1-i$, find $\\frac{z}{w}$", options:["$\\frac{-1+5i}{2}$","$\\frac{5+i}{2}$","$\\frac{-1-5i}{2}$","$\\frac{5-i}{2}$"], correctAnswers:[0], explanation:"$\\frac{(2+3i)(1+i)}{2}=\\frac{-1+5i}{2}$", points:1 }
    ]
  },
  {
    id: "math-aa-hl-functions", schemaVersion: "1.0", title: "IB Math AA HL - Functions", subject: "math-aa-hl", topic: "Functions", difficulty: "hard",
    description: "Functions, transformations, inverse functions, and polynomial/rational functions", tags: ["ib","math","functions","transformations","polynomials"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"If $f(x)=\\frac{2x+1}{x-3}$, find $f^{-1}(x)$", options:["$\\frac{3x+1}{x-2}$","$\\frac{x-3}{2x+1}$","$\\frac{3x-1}{x+2}$","$\\frac{x+3}{2-x}$"], correctAnswers:[0], explanation:"$f^{-1}(x)=\\frac{3x+1}{x-2}$", points:1 },
      { id:"q2", type:"mcq", question:"$y=-f(x-2)+3$ transforms $y=f(x)$ by:", options:["Right 2, reflect x-axis, up 3","Reflect, right 2, up 3","Left 2, reflect y-axis, up 3","Up 3, reflect, right 2"], correctAnswers:[0], explanation:"Inside out: shift right 2, reflect in x-axis, shift up 3", points:1 },
      { id:"q3", type:"mcq", question:"Vertical asymptote(s) of $f(x)=\\frac{x^2-4}{x^2-x-6}$:", options:["$x=3$ only","$x=-2$ and $x=3$","$x=-2$ only","$x=2$ and $x=-3$"], correctAnswers:[0], explanation:"Factor to $\\frac{x-2}{x-3}$ with hole at $x=-2$", points:1 },
      { id:"q4", type:"mcq", question:"If $f(x)=e^{2x}$ and $g(x)=\\ln(x+1)$, find $(f\\circ g)(x)$", options:["$(x+1)^2$","$e^{2\\ln(x+1)}$","$2\\ln(e^x+1)$","$\\ln(e^{2x}+1)$"], correctAnswers:[0], explanation:"$e^{2\\ln(x+1)}=(x+1)^2$", points:1 },
      { id:"q5", type:"mcq", question:"Solve $\\log_2(x+3)+\\log_2(x-1)=3$", options:["$x=\\frac{-1+\\sqrt{37}}{2}$","$x=3$","$x=5$","$x=\\frac{1+\\sqrt{37}}{2}$"], correctAnswers:[1], explanation:"$(x+3)(x-1)=8$, $x=3$ works", points:1 },
      { id:"q6", type:"frq", question:"Find the x-coordinate of the vertex of $y=2x^2-12x+7$", correctAnswers:["3"], explanation:"$x=-\\frac{b}{2a}=3$", points:1 },
      { id:"q7", type:"mcq", question:"$f(x)=|x-2|+|x+1|$ has minimum value:", options:["$3$","$0$","$1$","$2$"], correctAnswers:[0], explanation:"For $-1\\le x\\le 2$: $f(x)=3$. Min is 3.", points:1 }
    ]
  },
  {
    id: "math-aa-hl-trig", schemaVersion: "1.0", title: "IB Math AA HL - Trigonometry & Geometry", subject: "math-aa-hl", topic: "Trigonometry and Geometry", difficulty: "hard",
    description: "Trig identities, equations, vectors, and coordinate geometry", tags: ["ib","math","trigonometry","vectors","geometry"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Simplify $\\frac{\\sin 2\\theta}{1+\\cos 2\\theta}$", options:["$\\tan\\theta$","$\\cot\\theta$","$2\\tan\\theta$","$\\frac{1}{2}\\tan\\theta$"], correctAnswers:[0], explanation:"$=\\frac{2\\sin\\theta\\cos\\theta}{2\\cos^2\\theta}=\\tan\\theta$", points:1 },
      { id:"q2", type:"mcq", question:"Express $\\sin\\theta+\\sqrt{3}\\cos\\theta$ as $R\\sin(\\theta+\\alpha)$", options:["$2\\sin(\\theta+\\frac{\\pi}{3})$","$2\\sin(\\theta+\\frac{\\pi}{6})$","$\\sqrt{2}\\sin(\\theta+\\frac{\\pi}{4})$","$2\\cos(\\theta-\\frac{\\pi}{6})$"], correctAnswers:[0], explanation:"$R=2$, $\\alpha=\\frac{\\pi}{3}$", points:1 },
      { id:"q3", type:"mcq", question:"$\\mathbf{a}=\\begin{pmatrix}2\\\\-1\\\\3\\end{pmatrix}$, $\\mathbf{b}=\\begin{pmatrix}1\\\\4\\\\-2\\end{pmatrix}$. Find $\\mathbf{a}\\times\\mathbf{b}$", options:["$\\begin{pmatrix}-10\\\\7\\\\9\\end{pmatrix}$","$\\begin{pmatrix}10\\\\-7\\\\-9\\end{pmatrix}$","$\\begin{pmatrix}-10\\\\-7\\\\9\\end{pmatrix}$","$\\begin{pmatrix}10\\\\7\\\\9\\end{pmatrix}$"], correctAnswers:[0], explanation:"Cross product calculation", points:1 },
      { id:"q4", type:"mcq", question:"$\\frac{1-\\cos 2\\theta}{\\sin 2\\theta}=\\tan\\theta$ uses:", options:["$1-\\cos 2\\theta=2\\sin^2\\theta$","$\\sin 2\\theta=2\\sin\\theta\\cos\\theta$","Both of the above","$\\cos 2\\theta=\\cos^2\\theta-\\sin^2\\theta$"], correctAnswers:[2], explanation:"Both identities are needed", points:1 },
      { id:"q5", type:"mcq", question:"Plane through $(1,0,0)$, $(0,2,0)$, $(0,0,3)$:", options:["$6x+3y+2z=6$","$x+2y+3z=6$","$\\frac{x}{1}+\\frac{y}{2}+\\frac{z}{3}=1$","Both A and C"], correctAnswers:[3], explanation:"Intercept form gives equivalent equations", points:1 },
      { id:"q6", type:"mcq", question:"$\\tan\\alpha=\\frac{1}{2}$, $\\tan\\beta=\\frac{1}{3}$. Find $\\tan(\\alpha+\\beta)$", options:["$1$","$\\frac{5}{6}$","$\\frac{5}{5}$","$\\frac{7}{6}$"], correctAnswers:[0], explanation:"$\\frac{\\frac{5}{6}}{\\frac{5}{6}}=1$", points:1 }
    ]
  },
  {
    id: "math-aa-hl-stats", schemaVersion: "1.0", title: "IB Math AA HL - Statistics & Probability", subject: "math-aa-hl", topic: "Statistics and Probability", difficulty: "hard",
    description: "Probability, distributions, Bayes' theorem, and hypothesis testing", tags: ["ib","math","statistics","probability","distributions"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"If $X\\sim N(50,16)$, find $P(X>54)$", options:["$P(Z>1)\\approx 0.159$","$P(Z>0.25)\\approx 0.401$","$P(Z>2)\\approx 0.023$","$P(Z>4)\\approx 0$"], correctAnswers:[0], explanation:"$Z=\\frac{54-50}{4}=1$", points:1 },
      { id:"q2", type:"mcq", question:"5 red and 3 blue balls. Two drawn without replacement. $P(\\text{both red})=$", options:["$\\frac{5}{14}$","$\\frac{25}{64}$","$\\frac{10}{28}$","$\\frac{5}{8}$"], correctAnswers:[0], explanation:"$\\frac{5}{8}\\times\\frac{4}{7}=\\frac{5}{14}$", points:1 },
      { id:"q3", type:"mcq", question:"$P(A)=0.4$, $P(B)=0.5$, $P(A\\cup B)=0.7$. Find $P(A|B)$", options:["$0.4$","$0.2$","$0.5$","$0.6$"], correctAnswers:[0], explanation:"$P(A\\cap B)=0.2$, $P(A|B)=0.4$", points:1 },
      { id:"q4", type:"mcq", question:"Factory: Machine A (60%, 2% defect), Machine B (40%, 5% defect). Item defective. $P(\\text{from B})=$", options:["$\\frac{5}{8}$","$\\frac{20}{32}$","$\\frac{10}{16}$","$\\frac{20}{52}$"], correctAnswers:[0], explanation:"Bayes: $\\frac{0.02}{0.032}=\\frac{5}{8}$", points:2 },
      { id:"q5", type:"frq", question:"If $X\\sim B(10,0.3)$, find $E(X)$", correctAnswers:["3"], explanation:"$E(X)=np=3$", points:1 },
      { id:"q6", type:"mcq", question:"MISSISSIPPI arrangements:", options:["$\\frac{11!}{4!4!2!}$","$\\frac{11!}{4!4!2!1!}$","$11!$","$\\frac{11!}{2!4!4!}$"], correctAnswers:[0], explanation:"M(1), I(4), S(4), P(2)", points:1 },
      { id:"q7", type:"mcq", question:"$H_0:\\mu=100$ vs $H_1:\\mu>100$, p-value=0.032, $\\alpha=0.05$:", options:["Reject $H_0$","Do not reject $H_0$","Accept $H_1$ definitively","Inconclusive"], correctAnswers:[0], explanation:"p < α, reject H0", points:1 },
      { id:"q8", type:"mcq", question:"$E(X)=5$, $\\text{Var}(X)=2$. Find $E(3X-4)$ and $\\text{Var}(3X-4)$", options:["$E=11$, $\\text{Var}=18$","$E=11$, $\\text{Var}=6$","$E=15$, $\\text{Var}=18$","$E=11$, $\\text{Var}=2$"], correctAnswers:[0], explanation:"$E=3(5)-4=11$, $\\text{Var}=9(2)=18$", points:1 }
    ]
  },
  {
    id: "math-aa-hl-calculus", schemaVersion: "1.0", title: "IB Math AA HL - Calculus", subject: "math-aa-hl", topic: "Calculus", difficulty: "hard",
    description: "Differentiation, integration, differential equations, and Maclaurin series", tags: ["ib","math","calculus","differentiation","integration"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Find $\\frac{dy}{dx}$ if $y=x^2e^{3x}$", options:["$e^{3x}(2x+3x^2)$","$2xe^{3x}$","$3x^2e^{3x}$","$e^{3x}(2x+3x)$"], correctAnswers:[0], explanation:"Product rule", points:1 },
      { id:"q2", type:"mcq", question:"$\\int\\frac{1}{x^2+4}dx=$", options:["$\\frac{1}{2}\\arctan\\frac{x}{2}+C$","$\\arctan\\frac{x}{2}+C$","$\\frac{1}{4}\\arctan\\frac{x}{4}+C$","$\\ln(x^2+4)+C$"], correctAnswers:[0], explanation:"Standard form with $a=2$", points:1 },
      { id:"q3", type:"mcq", question:"General solution of $\\frac{dy}{dx}=\\frac{y}{x}$:", options:["$y=Cx$","$y=x+C$","$y=Ce^x$","$y=\\frac{C}{x}$"], correctAnswers:[0], explanation:"Separable: $\\ln|y|=\\ln|x|+c$", points:1 },
      { id:"q4", type:"mcq", question:"Maclaurin series for $e^x$ up to $x^3$:", options:["$1+x+\\frac{x^2}{2!}+\\frac{x^3}{3!}$","$1+x+x^2+x^3$","$x+\\frac{x^2}{2}+\\frac{x^3}{6}$","$1+x+\\frac{x^2}{2}+\\frac{x^3}{3}$"], correctAnswers:[0], explanation:"$e^x=\\sum\\frac{x^n}{n!}$", points:1 },
      { id:"q5", type:"mcq", question:"$\\int_0^{\\pi/2}\\sin^2 x\\,dx=$", options:["$\\frac{\\pi}{4}$","$\\frac{\\pi}{2}$","$\\frac{1}{2}$","$1$"], correctAnswers:[0], explanation:"Use $\\sin^2x=\\frac{1-\\cos 2x}{2}$", points:1 },
      { id:"q6", type:"mcq", question:"Integrating factor for $\\frac{dy}{dx}+2y=e^{-x}$:", options:["$e^{2x}$","$e^{-2x}$","$2x$","$e^x$"], correctAnswers:[0], explanation:"$\\mu=e^{\\int 2dx}=e^{2x}$", points:1 },
      { id:"q7", type:"mcq", question:"Volume when $y=\\sqrt{x}$ rotated about x-axis, $x\\in[0,4]$:", options:["$8\\pi$","$4\\pi$","$16\\pi$","$2\\pi$"], correctAnswers:[0], explanation:"$\\pi\\int_0^4 x\\,dx=8\\pi$", points:1 },
      { id:"q8", type:"mcq", question:"$\\lim_{x\\to 0}\\frac{e^x-1-x}{x^2}$ using L'Hôpital:", options:["$\\frac{1}{2}$","$0$","$1$","$\\infty$"], correctAnswers:[0], explanation:"Apply twice: $\\frac{e^x}{2}\\to\\frac{1}{2}$", points:1 },
      { id:"q9", type:"frq", question:"Area between $y=x^2$ and $y=2x$ for $x\\ge 0$", correctAnswers:["4/3","1.33","1.333"], explanation:"$\\int_0^2(2x-x^2)dx=\\frac{4}{3}$", points:2 }
    ]
  },
  // ----- IB Physics -----
  {
    id: "physics-measurements", schemaVersion: "1.0", title: "IB Physics - Measurements & Uncertainties", subject: "physics", topic: "Measurements and Uncertainties", difficulty: "medium",
    description: "SI units, uncertainties, significant figures, and error propagation", tags: ["ib","physics","measurements","uncertainties"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Which is a fundamental SI base unit?", options:["Ampere (A)","Newton (N)","Joule (J)","Pascal (Pa)"], correctAnswers:[0], explanation:"Ampere is an SI base unit", points:1 },
      { id:"q2", type:"mcq", question:"Length $5.0\\pm0.1$ cm, width $2.0\\pm0.1$ cm. % uncertainty in area:", options:["$7\\%$","$5\\%$","$10\\%$","$2\\%$"], correctAnswers:[0], explanation:"2%+5%=7%", points:1 },
      { id:"q3", type:"frq", question:"Significant figures in $0.00340$ m?", correctAnswers:["3","three"], explanation:"3,4, and trailing 0 are significant", points:1 },
      { id:"q4", type:"mcq", question:"$T=2\\pi\\sqrt{l/g}$. If $l$ has 4% uncertainty, $T$ has:", options:["$2\\%$","$4\\%$","$8\\%$","$16\\%$"], correctAnswers:[0], explanation:"$T\\propto l^{1/2}$, so half: 2%", points:1 },
      { id:"q5", type:"mcq", question:"Systematic error causes measurements to be:", options:["Consistently shifted one direction","Randomly scattered","Accurate and precise","Unreproducible"], correctAnswers:[0], explanation:"Systematic = consistent bias", points:1 },
      { id:"q6", type:"mcq", question:"Newton in SI base units:", options:["$\\text{kg}\\cdot\\text{m}\\cdot\\text{s}^{-2}$","$\\text{kg}\\cdot\\text{m}^2\\cdot\\text{s}^{-2}$","$\\text{kg}\\cdot\\text{m}\\cdot\\text{s}^{-1}$","$\\text{kg}^2\\cdot\\text{m}\\cdot\\text{s}^{-2}$"], correctAnswers:[0], explanation:"$F=ma$", points:1 },
      { id:"q7", type:"mcq", question:"High precision but low accuracy means:", options:["Close together, far from true value","Spread out, centered on true value","Close together and near true value","Spread out and far from true value"], correctAnswers:[0], explanation:"Precision ≠ accuracy", points:1 }
    ]
  },
  {
    id: "physics-mechanics", schemaVersion: "1.0", title: "IB Physics - Mechanics", subject: "physics", topic: "Mechanics", difficulty: "medium",
    description: "Kinematics, dynamics, work/energy, and momentum", tags: ["ib","physics","mechanics","kinematics","dynamics","energy","momentum"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Ball thrown up at $20$ m/s. Max height ($g=10$):", options:["$20$ m","$40$ m","$10$ m","$200$ m"], correctAnswers:[0], explanation:"$v^2=u^2-2gs$", points:1 },
      { id:"q2", type:"mcq", question:"5 kg object, $a=3$ m/s². Net force:", options:["$15$ N","$1.67$ N","$8$ N","$0.6$ N"], correctAnswers:[0], explanation:"$F=ma=15$ N", points:1 },
      { id:"q3", type:"frq", question:"Car: rest to 30 m/s in 10 s. Distance (m)?", correctAnswers:["150"], explanation:"$s=\\frac{1}{2}(3)(100)=150$", points:1 },
      { id:"q4", type:"mcq", question:"3 kg at 4 m/s hits stationary 2 kg, stick together. Final velocity:", options:["$2.4$ m/s","$4.0$ m/s","$1.2$ m/s","$6.0$ m/s"], correctAnswers:[0], explanation:"$12=5v$, $v=2.4$", points:1 },
      { id:"q5", type:"mcq", question:"2 kg slides frictionless from height 5 m. Speed at bottom:", options:["$10$ m/s","$5$ m/s","$\\sqrt{50}$ m/s","$20$ m/s"], correctAnswers:[0], explanation:"$v=\\sqrt{2gh}=10$", points:1 },
      { id:"q6", type:"mcq", question:"Projectile at 30° with 40 m/s. Time to max height ($g=10$):", options:["$2$ s","$4$ s","$1$ s","$3$ s"], correctAnswers:[0], explanation:"$v_y=20$, $t=2$ s", points:1 },
      { id:"q7", type:"mcq", question:"Newton's third law:", options:["Equal/opposite reaction on different body","Object at rest stays at rest","F=ma","Equal/opposite on same body"], correctAnswers:[0], explanation:"Action-reaction on different bodies", points:1 },
      { id:"q8", type:"mcq", question:"Work by gravity on 2 kg falling 10 m:", options:["$200$ J","$20$ J","$100$ J","$-200$ J"], correctAnswers:[0], explanation:"$W=mgh=200$ J", points:1 },
      { id:"q9", type:"frq", question:"Impulse of 30 N·s on 5 kg at rest. Final velocity (m/s)?", correctAnswers:["6"], explanation:"$30=5v$", points:1 }
    ]
  },
  {
    id: "physics-thermal", schemaVersion: "1.0", title: "IB Physics - Thermal Physics", subject: "physics", topic: "Thermal Physics", difficulty: "medium",
    description: "Temperature, internal energy, ideal gases, and thermodynamics", tags: ["ib","physics","thermal","heat","ideal gas"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Convert 100°C to kelvin:", options:["373 K","273 K","100 K","173 K"], correctAnswers:[0], explanation:"T(K)=T(°C)+273", points:1 },
      { id:"q2", type:"frq", question:"Energy (kJ) to heat 2 kg water from 20°C to 80°C? ($c=4200$ J/kg·K)", correctAnswers:["504"], explanation:"$Q=mc\\Delta T=504$ kJ", points:1 },
      { id:"q3", type:"mcq", question:"Average KE of gas molecules is proportional to:", options:["Absolute temperature","Celsius temperature","Pressure","Volume"], correctAnswers:[0], explanation:"$\\bar{E_k}=\\frac{3}{2}k_BT$", points:1 },
      { id:"q4", type:"mcq", question:"Ideal gas at 300 K, 100 kPa compressed to half volume (constant T). New pressure:", options:["200 kPa","50 kPa","100 kPa","400 kPa"], correctAnswers:[0], explanation:"Boyle's Law: $PV=$ const", points:1 },
      { id:"q5", type:"mcq", question:"Isothermal expansion of ideal gas:", options:["$\\Delta U=0$, $Q=W$","T increases","No heat transfer","P constant"], correctAnswers:[0], explanation:"Constant T means constant U for ideal gas", points:1 },
      { id:"q6", type:"mcq", question:"Specific latent heat of vaporization:", options:["Energy to change 1 kg liquid to gas at constant T","Energy to change 1 kg solid to liquid","Energy to raise 1 kg by 1 K","Energy to change all liquid to gas"], correctAnswers:[0], explanation:"Per unit mass, liquid→gas, constant T", points:1 },
      { id:"q7", type:"mcq", question:"Adiabatic process:", options:["$Q=0$, $\\Delta U=-W$","Constant T","Constant V","Constant P"], correctAnswers:[0], explanation:"No heat transfer: $\\Delta U=-W$", points:1 },
      { id:"q8", type:"mcq", question:"Internal energy of ideal gas depends on:", options:["Temperature only","P and V","V only","P, V, and T"], correctAnswers:[0], explanation:"$U=\\frac{3}{2}nRT$", points:1 }
    ]
  },
  {
    id: "physics-waves", schemaVersion: "1.0", title: "IB Physics - Waves", subject: "physics", topic: "Waves", difficulty: "medium",
    description: "Wave properties, standing waves, interference, diffraction, and Doppler effect", tags: ["ib","physics","waves","interference","diffraction","doppler"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Wave: $f=50$ Hz, $\\lambda=0.4$ m. Speed:", options:["$20$ m/s","$125$ m/s","$0.008$ m/s","$50.4$ m/s"], correctAnswers:[0], explanation:"$v=f\\lambda=20$", points:1 },
      { id:"q2", type:"mcq", question:"Distance between adjacent nodes in standing wave:", options:["$\\lambda/2$","$\\lambda$","$\\lambda/4$","$2\\lambda$"], correctAnswers:[0], explanation:"Half wavelength between nodes", points:1 },
      { id:"q3", type:"mcq", question:"Young's double slit: if $d$ is halved, fringe spacing:", options:["Doubles","Halves","Same","Quadruples"], correctAnswers:[0], explanation:"$s\\propto 1/d$", points:1 },
      { id:"q4", type:"mcq", question:"Constructive interference condition (double slit):", options:["Path diff $=n\\lambda$","Path diff $=(n+\\frac{1}{2})\\lambda$","Path diff $=0$ only","Path diff $=n\\lambda/2$"], correctAnswers:[0], explanation:"Whole number of wavelengths", points:1 },
      { id:"q5", type:"mcq", question:"500 Hz source moves toward observer at 34 m/s (sound=340 m/s). Observed frequency:", options:["$\\approx 556$ Hz","$\\approx 450$ Hz","$\\approx 500$ Hz","$\\approx 600$ Hz"], correctAnswers:[0], explanation:"$f'=500\\times\\frac{340}{306}\\approx 556$", points:1 },
      { id:"q6", type:"mcq", question:"Polarization is a property of:", options:["Transverse waves only","Longitudinal waves only","Both types","Neither"], correctAnswers:[0], explanation:"Only transverse can be polarized", points:1 },
      { id:"q7", type:"mcq", question:"Single-slit first minimum: $b\\sin\\theta=$", options:["$\\lambda$","$\\lambda/2$","$2\\lambda$","$\\lambda\\cos\\theta$"], correctAnswers:[0], explanation:"$b\\sin\\theta=n\\lambda$ for minima", points:1 },
      { id:"q8", type:"mcq", question:"Intensity is proportional to:", options:["Amplitude²","Amplitude","Frequency","Wavelength"], correctAnswers:[0], explanation:"$I\\propto A^2$", points:1 }
    ]
  },
  {
    id: "physics-electricity", schemaVersion: "1.0", title: "IB Physics - Electricity & Magnetism", subject: "physics", topic: "Electricity and Magnetism", difficulty: "medium",
    description: "Electric fields, circuits, resistors, and magnetic forces", tags: ["ib","physics","electricity","magnetism","circuits"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Electric field at distance $r$ from charge $Q$:", options:["$E=kQ/r^2$","$E=kQ/r$","$E=kQ^2/r^2$","$E=kQ/2r^2$"], correctAnswers:[0], explanation:"Coulomb's law", points:1 },
      { id:"q2", type:"frq", question:"$2\\Omega$, $3\\Omega$, $6\\Omega$ in parallel. Total resistance?", correctAnswers:["1"], explanation:"$1/R=1/2+1/3+1/6=1$", points:1 },
      { id:"q3", type:"mcq", question:"EMF 12 V, internal resistance 2Ω, external 4Ω. Current:", options:["2 A","3 A","6 A","1 A"], correctAnswers:[0], explanation:"$I=12/6=2$ A", points:1 },
      { id:"q4", type:"mcq", question:"Power in 10Ω resistor with 3 A:", options:["90 W","30 W","0.9 W","270 W"], correctAnswers:[0], explanation:"$P=I^2R=90$ W", points:1 },
      { id:"q5", type:"mcq", question:"Force on wire in magnetic field:", options:["$F=BIL\\sin\\theta$","$F=BIL\\cos\\theta$","$F=BIL$","$F=BIL/\\sin\\theta$"], correctAnswers:[0], explanation:"$F=BIL\\sin\\theta$", points:1 },
      { id:"q6", type:"mcq", question:"Kirchhoff's first law is based on conservation of:", options:["Charge","Energy","Momentum","Mass"], correctAnswers:[0], explanation:"Sum of currents at junction = 0", points:1 },
      { id:"q7", type:"mcq", question:"Charge moves parallel to magnetic field. Force:", options:["0","$qvB$","$qvB\\sin 90°$","$qv/B$"], correctAnswers:[0], explanation:"$\\theta=0$, $\\sin 0=0$", points:1 },
      { id:"q8", type:"mcq", question:"Potential divider: $R_1=3$ kΩ, $R_2=6$ kΩ, 9 V supply. $V_{R_2}=$", options:["6 V","3 V","4.5 V","9 V"], correctAnswers:[0], explanation:"$V_2=\\frac{R_2}{R_1+R_2}\\times V=6$ V", points:1 }
    ]
  },
  {
    id: "physics-circular-gravitation", schemaVersion: "1.0", title: "IB Physics - Circular Motion & Gravitation", subject: "physics", topic: "Circular Motion and Gravitation", difficulty: "hard",
    description: "Uniform circular motion, gravitational fields, and orbital mechanics", tags: ["ib","physics","circular motion","gravitation","orbits"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"2 kg, radius 3 m, speed 6 m/s. Centripetal force:", options:["24 N","12 N","36 N","4 N"], correctAnswers:[0], explanation:"$F=mv^2/r=24$", points:1 },
      { id:"q2", type:"mcq", question:"Newton's law of gravitation:", options:["$F=Gm_1m_2/r^2$","$F=Gm_1m_2/r$","$F=Gm_1m_2r^2$","$F=G(m_1+m_2)/r^2$"], correctAnswers:[0], explanation:"Inverse square law", points:1 },
      { id:"q3", type:"frq", question:"Satellite orbits at radius $R$ with period $T$. At $4R$, period is $nT$. Find $n$.", correctAnswers:["8"], explanation:"Kepler: $T^2\\propto r^3$, $n=8$", points:2 },
      { id:"q4", type:"mcq", question:"Gravitational field strength at surface:", options:["$g=GM/R^2$","$g=GM/R$","$g=GM^2/R^2$","$g=GMR^2$"], correctAnswers:[0], explanation:"From $F=mg=GMm/R^2$", points:1 },
      { id:"q5", type:"mcq", question:"Uniform circular motion:", options:["Speed constant, velocity changes","Both constant","Acceleration is zero","Net force is tangential"], correctAnswers:[0], explanation:"Direction changes continuously", points:1 },
      { id:"q6", type:"mcq", question:"Escape velocity:", options:["$v=\\sqrt{2GM/R}$","$v=\\sqrt{GM/R}$","$v=2GM/R$","$v=\\sqrt{GM/2R}$"], correctAnswers:[0], explanation:"KE = GPE: $v=\\sqrt{2GM/R}$", points:1 },
      { id:"q7", type:"mcq", question:"Gravitational potential at distance $r$ from mass $M$:", options:["$V=-GM/r$","$V=GM/r$","$V=-GM/r^2$","$V=0$ at surface"], correctAnswers:[0], explanation:"Always negative, zero at infinity", points:1 },
      { id:"q8", type:"mcq", question:"Orbital speed at distance $r$:", options:["$v=\\sqrt{GM/r}$","$v=\\sqrt{2GM/r}$","$v=GM/r$","$v=\\sqrt{GMr}$"], correctAnswers:[0], explanation:"$GMm/r^2=mv^2/r$", points:1 }
    ]
  },
  {
    id: "physics-atomic-nuclear", schemaVersion: "1.0", title: "IB Physics - Atomic, Nuclear & Particle Physics", subject: "physics", topic: "Atomic, Nuclear, and Particle Physics", difficulty: "hard",
    description: "Atomic structure, radioactivity, nuclear reactions, and particle physics", tags: ["ib","physics","atomic","nuclear","particle","radioactivity"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Alpha decay emits:", options:["Helium-4 nucleus","Electron","Photon","Neutron"], correctAnswers:[0], explanation:"$^4_2He$", points:1 },
      { id:"q2", type:"mcq", question:"Half-life 8 days. Fraction after 24 days:", options:["$1/8$","$1/4$","$1/3$","$1/16$"], correctAnswers:[0], explanation:"3 half-lives: $(1/2)^3=1/8$", points:1 },
      { id:"q3", type:"mcq", question:"$\\beta^-$ decay:", options:["n→p + e⁻ + antineutrino","p→n + e⁺ + neutrino","Neutron ejected","Electron captured"], correctAnswers:[0], explanation:"Neutron converts to proton", points:1 },
      { id:"q4", type:"mcq", question:"Highest binding energy per nucleon:", options:["Iron-56","Hydrogen-1","Uranium-238","Helium-4"], correctAnswers:[0], explanation:"Fe-56 peak at ~8.8 MeV/nucleon", points:1 },
      { id:"q5", type:"mcq", question:"Force holding quarks together:", options:["Strong nuclear","Electromagnetic","Weak nuclear","Gravitational"], correctAnswers:[0], explanation:"Strong force via gluons", points:1 },
      { id:"q6", type:"mcq", question:"Proton quarks:", options:["uud","udd","uds","uuu"], correctAnswers:[0], explanation:"Charge: 2/3+2/3−1/3=+1", points:1 },
      { id:"q7", type:"mcq", question:"Nuclear fission of U-235:", options:["Heavy nucleus splits, releasing energy + neutrons","Two light nuclei combine","Nucleus emits alpha","Nucleus captures electron"], correctAnswers:[0], explanation:"Fission = splitting", points:1 },
      { id:"q8", type:"mcq", question:"Activity 800 Bq. After 2 half-lives:", options:["200 Bq","400 Bq","100 Bq","0 Bq"], correctAnswers:[0], explanation:"800→400→200", points:1 },
      { id:"q9", type:"mcq", question:"Which is a lepton?", options:["Electron","Proton","Neutron","Pion"], correctAnswers:[0], explanation:"Leptons: e, μ, τ and neutrinos", points:1 },
      { id:"q10", type:"mcq", question:"Bohr model: photon energy for $n=3\\to n=2$ transition:", options:["1.89 eV","3.40 eV","10.2 eV","1.51 eV"], correctAnswers:[0], explanation:"$\\Delta E=-1.51-(-3.40)=1.89$ eV", points:1 }
    ]
  },
  {
    id: "physics-energy-production", schemaVersion: "1.0", title: "IB Physics - Energy Production", subject: "physics", topic: "Energy Production", difficulty: "medium",
    description: "Energy sources, thermal energy transfer, and greenhouse effect", tags: ["ib","physics","energy","renewable","greenhouse"], author: "OpenNotes", createdAt: "2026-02-06T00:00:00Z",
    questions: [
      { id:"q1", type:"mcq", question:"Typical thermal power station efficiency:", options:["30-40%","80-90%","5-10%","90-100%"], correctAnswers:[0], explanation:"Carnot limits", points:1 },
      { id:"q2", type:"mcq", question:"Stefan-Boltzmann law:", options:["$P=\\sigma AT^4$","$P=\\sigma AT^2$","$P=\\sigma AT$","$P=\\sigma A/T^4$"], correctAnswers:[0], explanation:"Power ∝ T⁴", points:1 },
      { id:"q3", type:"mcq", question:"Main greenhouse gas for enhanced effect:", options:["CO₂","N₂","O₂","Ar"], correctAnswers:[0], explanation:"Carbon dioxide from fossil fuels", points:1 },
      { id:"q4", type:"frq", question:"Solar panel: 2 m², 800 W/m², 20% efficiency. Power output (W)?", correctAnswers:["320"], explanation:"$0.2\\times 1600=320$ W", points:1 },
      { id:"q5", type:"mcq", question:"Wien's law: Sun at 5800 K. Peak wavelength:", options:["~500 nm (visible)","~5000 nm (IR)","~50 nm (UV)","~5 nm (X-ray)"], correctAnswers:[0], explanation:"$\\lambda_{max}=b/T\\approx 500$ nm", points:1 },
      { id:"q6", type:"mcq", question:"Highest energy density source:", options:["Nuclear (uranium)","Coal","Natural gas","Wind"], correctAnswers:[0], explanation:"Nuclear ~10⁶× coal", points:1 },
      { id:"q7", type:"mcq", question:"Albedo is:", options:["Ratio of reflected to incident radiation","Total power absorbed","Emissivity","Surface temperature"], correctAnswers:[0], explanation:"Reflected/incident", points:1 },
      { id:"q8", type:"mcq", question:"Greenhouse gases work by:", options:["Absorbing/re-emitting IR from Earth surface","Absorbing visible from Sun","Reflecting sunlight","Increasing ozone"], correctAnswers:[0], explanation:"Transparent to visible, absorb IR", points:1 }
    ]
  }
];

/**
 * Seed built-in quizzes into storage (runs once on cold start)
 */
async function seedQuizzes(env) {
  if (quizzesSeeded) return;
  for (const quiz of SEED_QUIZZES) {
    const existing = await getQuiz(quiz.id, env);
    if (!existing) {
      await saveQuiz(quiz.id, quiz, env);
    }
  }
  quizzesSeeded = true;
}

/**
 * Generate a unique quiz ID
 */
function generateQuizId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Validate quiz structure
 */
function validateQuiz(quiz) {
  const errors = [];
  
  if (!quiz.title || typeof quiz.title !== 'string') {
    errors.push('Title is required');
  }
  
  if (!quiz.subject || typeof quiz.subject !== 'string') {
    errors.push('Subject is required');
  }
  
  if (!quiz.questions || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    errors.push('At least one question is required');
  } else {
    quiz.questions.forEach((q, i) => {
      if (!q.type || !['mcq', 'frq'].includes(q.type)) {
        errors.push(`Question ${i + 1}: Invalid type (must be mcq or frq)`);
      }
      if (!q.question || typeof q.question !== 'string') {
        errors.push(`Question ${i + 1}: Question text is required`);
      }
      if (q.type === 'mcq') {
        if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
          errors.push(`Question ${i + 1}: MCQ requires at least 2 options`);
        }
        if (!q.correctAnswers || !Array.isArray(q.correctAnswers) || q.correctAnswers.length === 0) {
          errors.push(`Question ${i + 1}: At least one correct answer is required`);
        }
      }
      if (q.type === 'frq') {
        if (!q.correctAnswers || !Array.isArray(q.correctAnswers) || q.correctAnswers.length === 0) {
          errors.push(`Question ${i + 1}: At least one accepted answer is required`);
        }
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Get quiz from storage (KV or in-memory)
 */
async function getQuiz(id, env) {
  if (env?.QUIZ_KV) {
    const data = await env.QUIZ_KV.get(`quiz:${id}`, 'json');
    return data;
  }
  return quizStore.get(id) || null;
}

/**
 * Save quiz to storage
 */
async function saveQuiz(id, quiz, env) {
  if (env?.QUIZ_KV) {
    await env.QUIZ_KV.put(`quiz:${id}`, JSON.stringify(quiz));
  } else {
    quizStore.set(id, quiz);
  }
}

/**
 * List all quizzes (with optional filters)
 */
async function listQuizzes(filters, env) {
  let quizzes = [];
  
  if (env?.QUIZ_KV) {
    const list = await env.QUIZ_KV.list({ prefix: 'quiz:' });
    for (const key of list.keys) {
      const quiz = await env.QUIZ_KV.get(key.name, 'json');
      if (quiz) {
        // Return summary, not full questions
        quizzes.push({
          id: quiz.id,
          title: quiz.title,
          subject: quiz.subject,
          topic: quiz.topic,
          difficulty: quiz.difficulty,
          questionCount: quiz.questions?.length || 0,
          author: quiz.author,
          createdAt: quiz.createdAt,
          tags: quiz.tags,
        });
      }
    }
  } else {
    for (const [id, quiz] of quizStore.entries()) {
      quizzes.push({
        id: quiz.id,
        title: quiz.title,
        subject: quiz.subject,
        topic: quiz.topic,
        difficulty: quiz.difficulty,
        questionCount: quiz.questions?.length || 0,
        author: quiz.author,
        createdAt: quiz.createdAt,
        tags: quiz.tags,
      });
    }
  }
  
  // Apply filters
  if (filters.subject) {
    quizzes = quizzes.filter(q => q.subject.toLowerCase() === filters.subject.toLowerCase());
  }
  if (filters.topic) {
    quizzes = quizzes.filter(q => q.topic?.toLowerCase().includes(filters.topic.toLowerCase()));
  }
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    quizzes = quizzes.filter(q => 
      q.title.toLowerCase().includes(searchLower) ||
      q.subject.toLowerCase().includes(searchLower) ||
      q.topic?.toLowerCase().includes(searchLower) ||
      q.tags?.some(t => t.toLowerCase().includes(searchLower))
    );
  }
  
  // Sort by creation date (newest first)
  quizzes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return quizzes;
}

/**
 * Delete quiz
 */
async function deleteQuiz(id, env) {
  if (env?.QUIZ_KV) {
    await env.QUIZ_KV.delete(`quiz:${id}`);
  } else {
    quizStore.delete(id);
  }
}

// Allowed origins for auth code creation (security)
const ALLOWED_AUTH_ORIGINS = [
  'https://nagusamecs.github.io',
  'http://localhost:5173', // Dev mode
  'tauri://localhost', // Tauri app
];

// Desktop app identifier for validation
const DESKTOP_APP_SECRET = 'opennotes-desktop-v1';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token, X-Desktop-App, X-Quiz-Token',
  'Access-Control-Max-Age': '86400',
};

// Auth code store (in-memory, expires after 5 minutes)
// In production, use Cloudflare KV for persistence across workers
const authCodeStore = new Map();

// Rate limiting store (per worker instance)
const rateLimitStore = new Map();

/**
 * Generate a random 6-digit code
 */
function generateAuthCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Clean up expired auth codes
 */
function cleanupExpiredCodes() {
  const now = Date.now();
  for (const [code, data] of authCodeStore.entries()) {
    if (now > data.expiresAt) {
      authCodeStore.delete(code);
    }
  }
}

/**
 * Validate app token against authorized tokens
 */
function validateAppToken(token, env) {
  if (!token) return { valid: false, app: null };
  
  try {
    const tokens = JSON.parse(env.APP_TOKENS || '{}');
    for (const [appId, config] of Object.entries(tokens)) {
      if (config.token === token && config.active) {
        return { valid: true, app: appId, config };
      }
    }
  } catch (e) {
    console.error('Token validation error:', e);
  }
  
  return { valid: false, app: null };
}

/**
 * Check rate limit for an app
 */
function checkRateLimit(appId, config) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const maxRequests = config?.rateLimit || 100;
  
  const key = `${appId}`;
  const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  
  record.count++;
  rateLimitStore.set(key, record);
  
  return {
    allowed: record.count <= maxRequests,
    remaining: Math.max(0, maxRequests - record.count),
    resetAt: record.resetAt,
  };
}

/**
 * Generate secure response headers
 */
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'",
  };
}

/**
 * Handle OPTIONS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Proxy request to OpenNotes API
 */
async function proxyToOpenNotes(request, env, appId) {
  const url = new URL(request.url);
  const targetUrl = new URL(OPENNOTES_API);
  
  // Copy search params
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });
  
  // Build proxy request
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': env.OPENNOTES_API_KEY,
      'Origin': 'https://nagusamecs.github.io',
      'Referer': 'https://nagusamecs.github.io/OpenNotesAPI/',
    },
  });
  
  try {
    const response = await fetch(proxyRequest);
    const data = await response.text();
    
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
        'X-App-Id': appId,
        'X-Powered-By': 'OpenNotesAPI Gateway',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Upstream API error' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
      },
    });
  }
}

/**
 * Handle API info endpoint
 */
function handleApiInfo() {
  return new Response(JSON.stringify({
    name: 'OpenNotes API Gateway',
    version: '1.1.0',
    status: 'operational',
    endpoints: {
      '/': 'API info',
      '/api/notes': 'List notes (requires X-App-Token)',
      '/api/notes/:id': 'Get note by ID (requires X-App-Token)',
      '/api/search': 'Search notes (requires X-App-Token)',
      '/api/health': 'Health check',
      '/auth/code': 'Create auth code (POST, from auth.html only)',
      '/auth/exchange': 'Exchange code for token (GET, desktop app only)',
      '/api/quizzes': 'List quizzes (GET), create quiz (POST)',
      '/api/quizzes/:id': 'Get quiz (GET), update quiz (PUT), delete quiz (DELETE)',
      '/api/quizzes/shuffle': 'POST - Combine and shuffle multiple quizzes',
    },
    quiz: {
      description: 'Quiz API for creating and accessing IB study quizzes',
      features: ['MCQ with multiple correct answers', 'FRQ with accepted answers', 'LaTeX support', 'Multi-quiz shuffle'],
    },
    documentation: 'https://nagusamecs.github.io/OpenNotesAPI/docs.html',
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...securityHeaders(),
    },
  });
}

/**
 * Handle health check
 */
function handleHealth() {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...securityHeaders(),
    },
  });
}

/**
 * Create an auth code for a token (called from auth.html)
 */
async function handleCreateAuthCode(request) {
  // Validate origin
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  
  const isAllowed = ALLOWED_AUTH_ORIGINS.some(allowed => 
    origin.startsWith(allowed) || referer.startsWith(allowed)
  );
  
  if (!isAllowed) {
    return new Response(JSON.stringify({
      error: 'Forbidden',
      message: 'This endpoint is only accessible from the OpenNotes auth page',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  try {
    const body = await request.json();
    const { token, user } = body;
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // Clean up expired codes
    cleanupExpiredCodes();
    
    // Generate unique 6-digit code
    let code;
    do {
      code = generateAuthCode();
    } while (authCodeStore.has(code));
    
    // Store with 5 minute expiry
    authCodeStore.set(code, {
      token,
      user: user || null,
      expiresAt: Date.now() + 5 * 60 * 1000,
      used: false,
    });
    
    return new Response(JSON.stringify({
      code,
      expiresIn: 300, // 5 minutes
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * Exchange auth code for token (called from desktop app)
 */
function handleExchangeCode(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const appSecret = request.headers.get('X-Desktop-App');
  
  // Validate desktop app header
  if (appSecret !== DESKTOP_APP_SECRET) {
    return new Response(JSON.stringify({
      error: 'Forbidden',
      message: 'This endpoint is only accessible from the OpenNotes Desktop app',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  if (!code || code.length !== 6) {
    return new Response(JSON.stringify({ error: 'Valid 6-digit code is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  // Clean up expired codes
  cleanupExpiredCodes();
  
  const data = authCodeStore.get(code);
  
  if (!data) {
    return new Response(JSON.stringify({ error: 'Invalid or expired code' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  if (data.used) {
    return new Response(JSON.stringify({ error: 'Code already used' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  // Mark as used and delete after successful exchange
  data.used = true;
  authCodeStore.delete(code);
  
  return new Response(JSON.stringify({
    token: data.token,
    user: data.user,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ==================== QUIZ HANDLERS ====================

/**
 * Validate quiz token for creating/modifying quizzes
 */
function validateQuizToken(request, env) {
  const token = request.headers.get('X-Quiz-Token') || request.headers.get('Authorization')?.replace('Bearer ', '');
  const authToken = request.headers.get('X-Auth-Token'); // User auth token
  
  // Admin token has full access
  if (token === env.ADMIN_TOKEN) {
    return { valid: true, role: 'admin' };
  }
  
  // Authenticated users can create quizzes
  if (authToken) {
    return { valid: true, role: 'user', token: authToken };
  }
  
  // Check app tokens for API access
  const appToken = request.headers.get('X-App-Token');
  if (appToken) {
    const validation = validateAppToken(appToken, env);
    if (validation.valid) {
      return { valid: true, role: 'app', app: validation.app };
    }
  }
  
  return { valid: false };
}

/**
 * Handle GET /api/quizzes - List all quizzes
 */
async function handleListQuizzes(request, env) {
  const url = new URL(request.url);
  const filters = {
    subject: url.searchParams.get('subject'),
    topic: url.searchParams.get('topic'),
    search: url.searchParams.get('q') || url.searchParams.get('search'),
  };
  
  const quizzes = await listQuizzes(filters, env);
  
  return new Response(JSON.stringify({
    quizzes,
    total: quizzes.length,
    filters: Object.fromEntries(Object.entries(filters).filter(([k, v]) => v)),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...securityHeaders() },
  });
}

/**
 * Handle POST /api/quizzes - Create a new quiz
 */
async function handleCreateQuiz(request, env) {
  const auth = validateQuizToken(request, env);
  if (!auth.valid) {
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      message: 'Authentication required to create quizzes',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  try {
    const body = await request.json();
    const validation = validateQuiz(body);
    
    if (!validation.valid) {
      return new Response(JSON.stringify({
        error: 'Validation failed',
        errors: validation.errors,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    const quizId = generateQuizId();
    const quiz = {
      id: quizId,
      schemaVersion: QUIZ_SCHEMA_VERSION,
      title: body.title,
      subject: body.subject,
      topic: body.topic || null,
      difficulty: body.difficulty || 'medium',
      description: body.description || '',
      tags: body.tags || [],
      questions: body.questions.map((q, i) => ({
        id: `q${i + 1}`,
        type: q.type,
        question: q.question,
        options: q.options || null,
        correctAnswers: q.correctAnswers,
        explanation: q.explanation || null,
        points: q.points || 1,
        hint: q.hint || null,
      })),
      author: body.author || (auth.role === 'user' ? 'Authenticated User' : auth.app || 'Anonymous'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await saveQuiz(quizId, quiz, env);
    
    return new Response(JSON.stringify({
      success: true,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        questionCount: quiz.questions.length,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Invalid request',
      message: e.message,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * Handle GET /api/quizzes/:id - Get a specific quiz
 */
async function handleGetQuiz(id, env) {
  const quiz = await getQuiz(id, env);
  
  if (!quiz) {
    return new Response(JSON.stringify({ error: 'Quiz not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  return new Response(JSON.stringify(quiz), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...securityHeaders() },
  });
}

/**
 * Handle DELETE /api/quizzes/:id - Delete a quiz
 */
async function handleDeleteQuiz(id, request, env) {
  const auth = validateQuizToken(request, env);
  if (!auth.valid || auth.role !== 'admin') {
    return new Response(JSON.stringify({
      error: 'Forbidden',
      message: 'Admin access required to delete quizzes',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  const quiz = await getQuiz(id, env);
  if (!quiz) {
    return new Response(JSON.stringify({ error: 'Quiz not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  await deleteQuiz(id, env);
  
  return new Response(JSON.stringify({ success: true, deleted: id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * Handle POST /api/quizzes/shuffle - Combine and shuffle multiple quizzes
 */
async function handleShuffleQuizzes(request, env) {
  try {
    const body = await request.json();
    const { quizIds, questionCount, shuffle = true } = body;
    
    if (!quizIds || !Array.isArray(quizIds) || quizIds.length === 0) {
      return new Response(JSON.stringify({
        error: 'quizIds array is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // Fetch all requested quizzes
    const quizzes = [];
    const notFound = [];
    
    for (const id of quizIds) {
      const quiz = await getQuiz(id, env);
      if (quiz) {
        quizzes.push(quiz);
      } else {
        notFound.push(id);
      }
    }
    
    if (notFound.length > 0) {
      return new Response(JSON.stringify({
        error: 'Some quizzes not found',
        notFound,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // Combine all questions
    let allQuestions = [];
    for (const quiz of quizzes) {
      allQuestions.push(...quiz.questions.map(q => ({
        ...q,
        sourceQuiz: quiz.id,
        sourceTitle: quiz.title,
      })));
    }
    
    // Shuffle if requested
    if (shuffle) {
      for (let i = allQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
      }
    }
    
    // Limit question count if specified
    if (questionCount && questionCount < allQuestions.length) {
      allQuestions = allQuestions.slice(0, questionCount);
    }
    
    // Generate combined quiz
    const combined = {
      id: 'combined-' + Date.now(),
      title: `Combined Quiz (${quizzes.map(q => q.title).join(', ')})`,
      subject: [...new Set(quizzes.map(q => q.subject))].join(', '),
      description: `Combined from ${quizzes.length} quizzes`,
      questions: allQuestions.map((q, i) => ({ ...q, id: `cq${i + 1}` })),
      sourceQuizzes: quizIds,
      createdAt: new Date().toISOString(),
      isTemporary: true,
    };
    
    return new Response(JSON.stringify(combined), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders, ...securityHeaders() },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Invalid request',
      message: e.message,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Seed built-in quizzes on first request
    await seedQuizzes(env);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    // Public endpoints
    if (path === '/' || path === '') {
      return handleApiInfo();
    }
    
    if (path === '/api/health' || path === '/health') {
      return handleHealth();
    }
    
    // Auth code endpoints (for desktop app authentication)
    if (path === '/auth/code' && request.method === 'POST') {
      return handleCreateAuthCode(request);
    }
    
    if (path === '/auth/exchange' && request.method === 'GET') {
      return handleExchangeCode(request);
    }
    
    // ==================== QUIZ ROUTES ====================
    // Quiz routes are public for reading, auth required for writing
    
    // POST /api/quizzes/shuffle - Combine and shuffle quizzes (public)
    if (path === '/api/quizzes/shuffle' && request.method === 'POST') {
      return handleShuffleQuizzes(request, env);
    }
    
    // GET /api/quizzes - List all quizzes (public)
    if (path === '/api/quizzes' && request.method === 'GET') {
      return handleListQuizzes(request, env);
    }
    
    // POST /api/quizzes - Create quiz (requires auth)
    if (path === '/api/quizzes' && request.method === 'POST') {
      return handleCreateQuiz(request, env);
    }
    
    // GET/DELETE /api/quizzes/:id - Get or delete specific quiz
    const quizMatch = path.match(/^\/api\/quizzes\/([a-z0-9]+)$/);
    if (quizMatch) {
      const quizId = quizMatch[1];
      if (request.method === 'GET') {
        return handleGetQuiz(quizId, env);
      }
      if (request.method === 'DELETE') {
        return handleDeleteQuiz(quizId, request, env);
      }
    }
    
    // Protected endpoints require app token
    const appToken = request.headers.get('X-App-Token');
    const authHeader = request.headers.get('Authorization');
    const token = appToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    
    // Allow requests from the official frontend without token
    const origin = request.headers.get('Origin') || '';
    const referer = request.headers.get('Referer') || '';
    const isOfficialFrontend = origin.includes('nagusamecs.github.io') || 
                               referer.includes('nagusamecs.github.io');
    
    let appId = 'anonymous';
    
    if (!isOfficialFrontend) {
      const validation = validateAppToken(token, env);
      
      if (!validation.valid) {
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          message: 'Valid X-App-Token header required. Request access at https://nagusamecs.github.io/OpenNotesAPI/',
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
            ...securityHeaders(),
          },
        });
      }
      
      appId = validation.app;
      
      // Check rate limit
      const rateLimit = checkRateLimit(appId, validation.config);
      if (!rateLimit.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
            'X-RateLimit-Remaining': '0',
            ...corsHeaders,
            ...securityHeaders(),
          },
        });
      }
    } else {
      appId = 'official-frontend';
    }
    
    // Route API requests
    if (path.startsWith('/api/')) {
      // Map paths to OpenNotes API params
      const apiPath = path.replace('/api/', '');
      
      // Set type parameter based on path
      if (apiPath === 'notes' || apiPath === 'notes/') {
        url.searchParams.set('type', 'list');
      } else if (apiPath.startsWith('notes/')) {
        const noteId = apiPath.replace('notes/', '');
        url.searchParams.set('type', 'note');
        url.searchParams.set('noteId', noteId);
      } else if (apiPath === 'search' || apiPath === 'search/') {
        url.searchParams.set('type', 'list');
      }
      
      return proxyToOpenNotes(new Request(url.toString(), request), env, appId);
    }
    
    // 404 for unknown paths
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: path,
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
      },
    });
  },
};
