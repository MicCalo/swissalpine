
using MathNet.Numerics;
using System.Diagnostics;

namespace Mical.UltraPredictor.Model
{
    public class GradeAdjustedPaceFit
    {
        private readonly Polynomial[] _polys;
        public GradeAdjustedPaceFit(params Polynomial[] polys)
        {
            _polys = polys;
        }

        public static GradeAdjustedPaceFit FromDefinition(string def)
        {
            string[] polyStrings = def.Split('|');
            var polys = polyStrings.Select(ReadPolyDef).ToArray();
            return new GradeAdjustedPaceFit(polys);
        }

        public string Definition => string.Join("|", _polys.Select(p => string.Join("+", p.Coefficients.Select(c=>c.ToString())))); 

        private static Polynomial ReadPolyDef(string def)
        {
            // format: "c0,c1,c2,..."
            double[] coeffs = def.Split('+').Select(double.Parse).ToArray();
            return new Polynomial(coeffs);
        }

        public double Evaluate(double gradient)
        {
            gradient = Math.Max(gradient, -0.3); // cap descent at 30% steepness

            if (_polys.Length == 1)
            {
                return _polys[0].Evaluate(gradient);
            }
            else if (_polys.Length == 2)
            {
                if (gradient > 0)
                {
                    return _polys[0].Evaluate(gradient);
                }
                else
                {
                    return _polys[1].Evaluate(gradient);

                }
            }
            else
            {
                throw new InvalidOperationException($"One or two polys expected, got {_polys.Length}");
            }
        }

        public void Show()
        {
            foreach (var g in new[] { -0.4, -0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3, 0.4 })
            {
                Debug.WriteLine($"g={g * 100:0}%: {Evaluate(g):F3}");
            }
        }
    }

    internal class GradeAdjustedPaceFitter
    {
        private List<double> _gradients = new();
        private List<double> _paceFactors = new();
        private List<double> _weights = new();

        public void Show()
        {
            var fit1 = FitPolynominal(true);
            var fit2 = FitPolynominal(false);

            foreach (var g in new[] { -0.4, -0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3, 0.4 })
            {
                Debug.WriteLine($"g={g * 100:0}%: {fit1.Evaluate(g):F3} / {fit2.Evaluate(g):F3}");
            }



            // How many descent segments per gradient band?
            foreach (var band in new[] {(40,45), (35, 40), (30, 35), (25,30), (20,25),(15,20), (10,15), (5,10), (0,5), (-5, 0), (-10, -5), (-20, -10), (-30, -20), (-40, -30) })
            {
                var count = _gradients
                    .Count(s => s >= band.Item1/100.0 && s < band.Item2/100.0);
                Debug.WriteLine($"{band.Item1}% to {band.Item2}%: {count} segments");
            }
        }

        public bool AddSegements(IEnumerable<Segment> segments)
        {
            if (!segments.Any())
            {
                return false;
            }

            var validSegments = segments
               .Where(s => s.MeanSpeed < 5.0)   // cap at 18 km/h — no trail runner goes faster
               .Where(s => s.MeanSpeed > 0.5)   // remove stopped segments
               .Where(s => s.Distance >= 50)        // exclude micro-segments (noisy pace)
               .Where(s => s.Duration.TotalSeconds >= 10) // exclude GPS glitches
               .ToList();

            var flatSegments = validSegments.Where(s => Math.Abs(s.GradientPercent) < 1.0).ToList();
            if (flatSegments.Count < 3)
            {
                Debug.WriteLine("Not enough flat segments to calculate pace factors. Need at least 3, got " + flatSegments.Count);
                return false;
            }



            double flatSpeed_u = flatSegments.Average(s => s.MeanSpeed);
            double flatSpeed = flatSegments.Sum(s => s.MeanSpeed * s.Distance)
                            / flatSegments.Sum(s => s.Distance);

            double flatSpeedKmh = flatSpeed * 3.6;
            if (flatSpeedKmh > 10.0 || flatSpeedKmh < 6 )
            {
                Debug.WriteLine("Flat speed out of expectation [6 to 10 km/h], got " + flatSpeedKmh + "km/h");
                return false;

            }

            _gradients.AddRange(validSegments.Select(s => s.Gradient));
            _paceFactors.AddRange(validSegments.Select(s => flatSpeed / s.MeanSpeed));
            _weights.AddRange(validSegments.Select(s => s.Distance));

            Debug.WriteLine($"Pace: {flatSpeed} m/s ,  {flatSpeedKmh} km/h");
            return true;
        }

        public GradeAdjustedPaceFit FitPolynominal(bool onePolyFit)
        {
            if (onePolyFit)
            {
                double[] coeffs = Fit.PolynomialWeighted(_gradients.ToArray(), _paceFactors.ToArray(), _weights.ToArray(), order: 4);
                Polynomial poly = new Polynomial(coeffs);

                return new GradeAdjustedPaceFit(poly);
            }
            else
            {
                List<double> gradientsUp = new();
                List<double> paceFactorsUp = new();
                List<double> weightsUp = new();
                List<double> gradientsDown = new();
                List<double> paceFactorsDown = new();
                List<double> weightsDown = new();
                for (int i=0; i < _gradients.Count; i++)
                {
                    if (_gradients[i] > 0)
                    {
                        gradientsUp.Add(_gradients[i]);
                        paceFactorsUp.Add(_paceFactors[i]);
                        weightsUp.Add(_weights[i]);
                    }
                    else
                    {
                        gradientsDown.Add(_gradients[i]);
                        paceFactorsDown.Add(_paceFactors[i]);
                        weightsDown.Add(_weights[i]);
                    }
                }
                Polynomial upPoly = new Polynomial(Fit.PolynomialWeighted(gradientsUp.ToArray(), paceFactorsUp.ToArray(), weightsUp.ToArray(), order: 3));
                Polynomial downPoly = new Polynomial(Fit.PolynomialWeighted(gradientsDown.ToArray(), paceFactorsDown.ToArray(), weightsDown.ToArray(), order: 2));
                return new GradeAdjustedPaceFit(upPoly, downPoly);
            }
        }
    }
}
