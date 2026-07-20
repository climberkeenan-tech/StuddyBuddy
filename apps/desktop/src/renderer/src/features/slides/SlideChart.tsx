import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Bar, Doughnut, Line, Pie } from 'react-chartjs-2';
import type { SlideChartSpec } from '@studdybuddy/shared';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Legend,
  Tooltip,
);

/** Palette used to tint chart series, mirroring the course accent colors. */
const PALETTE = ['#7c3aed', '#0891b2', '#d97706', '#e11d48', '#059669', '#2563eb', '#db2777', '#65a30d'];

export interface SlideChartProps {
  spec: SlideChartSpec;
  /** Whether the slide is displayed on a dark background (controls tick color). */
  dark?: boolean;
}

/**
 * Renders a {@link SlideChartSpec} with Chart.js. Lazy-loaded by the slide stage
 * so Chart.js only ships when a chart slide is actually viewed. Supports bar,
 * line, pie and doughnut kinds.
 */
export default function SlideChart({ spec, dark = true }: SlideChartProps) {
  const grid = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const tick = dark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.66)';

  const options: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600 },
    plugins: {
      legend: {
        display: spec.series.length > 1 || spec.kind === 'pie' || spec.kind === 'doughnut',
        labels: { color: tick, font: { size: 13 } },
      },
    },
  };

  if (spec.kind === 'bar' || spec.kind === 'line') {
    const data: ChartData<'bar' | 'line'> = {
      labels: spec.labels,
      datasets: spec.series.map((s, i) => ({
        label: s.label,
        data: s.data,
        backgroundColor: spec.kind === 'bar' ? PALETTE[i % PALETTE.length] : `${PALETTE[i % PALETTE.length]}33`,
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: 2,
        borderRadius: spec.kind === 'bar' ? 8 : 0,
        tension: 0.35,
        pointRadius: 3,
      })),
    };
    const scaled: ChartOptions<'bar' | 'line'> = {
      ...(options as ChartOptions<'bar' | 'line'>),
      scales: {
        x: { grid: { color: grid }, ticks: { color: tick } },
        y: { grid: { color: grid }, ticks: { color: tick }, beginAtZero: true },
      },
    };
    return spec.kind === 'bar' ? (
      <Bar data={data as ChartData<'bar'>} options={scaled as ChartOptions<'bar'>} />
    ) : (
      <Line data={data as ChartData<'line'>} options={scaled as ChartOptions<'line'>} />
    );
  }

  // pie / doughnut — first series drives the segments.
  const series = spec.series[0];
  const arcData: ChartData<'pie' | 'doughnut'> = {
    labels: spec.labels,
    datasets: [
      {
        label: series?.label ?? '',
        data: series?.data ?? [],
        backgroundColor: spec.labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: dark ? 'rgba(0,0,0,0.25)' : '#ffffff',
        borderWidth: 2,
      },
    ],
  };
  return spec.kind === 'pie' ? (
    <Pie data={arcData as ChartData<'pie'>} options={options as ChartOptions<'pie'>} />
  ) : (
    <Doughnut data={arcData as ChartData<'doughnut'>} options={options as ChartOptions<'doughnut'>} />
  );
}
