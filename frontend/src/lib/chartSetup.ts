import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, TimeScale, Tooltip,
} from 'chart.js';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
// Side-effect import - registers Chart.js's 'time'/'timeseries' scale adapter (candlestick
// charts need a genuine time x-axis, not the CategoryScale every other chart here uses).
import 'chartjs-adapter-date-fns';

// Registered once, imported (for the side effect) by every chart component
// — react-chartjs-2 requires the specific elements/scales/plugins used to be
// registered before any <Pie>/<Bar>/<Line>/<Chart type="candlestick"> renders.
ChartJS.register(
  ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Tooltip, Legend,
  CandlestickController, CandlestickElement,
);
