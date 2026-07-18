import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip,
} from 'chart.js';

// Registered once, imported (for the side effect) by every chart component
// — react-chartjs-2 requires the specific elements/scales/plugins used to be
// registered before any <Pie>/<Bar>/<Line> renders.
ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);
