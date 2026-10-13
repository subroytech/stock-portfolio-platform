import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import CandlestickPatternDiagram from './CandlestickPatternDiagram';

describe('CandlestickPatternDiagram', () => {
  test('renders an SVG with one candle shape for a single-candle pattern', () => {
    render(<CandlestickPatternDiagram patternName="Doji" />);
    const svg = screen.getByTestId('candlestick-pattern-diagram');
    expect(svg).toBeInTheDocument();
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect(svg.querySelectorAll('line')).toHaveLength(1);
  });

  test('renders one shape per candle for a multi-candle pattern', () => {
    render(<CandlestickPatternDiagram patternName="Morning Star" />);
    const svg = screen.getByTestId('candlestick-pattern-diagram');
    expect(svg.querySelectorAll('rect')).toHaveLength(3);
  });

  test('renders nothing for a pattern with no geometry defined', () => {
    const { container } = render(<CandlestickPatternDiagram patternName="Not A Real Pattern" />);
    expect(container).toBeEmptyDOMElement();
  });
});
