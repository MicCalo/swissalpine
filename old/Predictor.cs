
namespace Mical.UltraPredictor.Model;

internal class FatigueModel
{
    public FatigueModel()
    {
    }

    public double Onset { get; set; } = 40;
    public double Lambda { get; set; } = 0.009;
    public double Floor { get; set; } = 0.55;

    public double GetMultiplier(double cumulativeLkm)
    {
        if (cumulativeLkm <= Onset) return 1.0;
        return Floor + (1.0 - Floor) * Math.Exp(-Lambda * (cumulativeLkm - Onset));
    }
}

internal class Predictor
{
    private readonly GradeAdjustedPaceFit _gradeAdjustment;
    private readonly FatigueModel _fatigueModel;

    public Predictor(GradeAdjustedPaceFit gradeAdjustment, FatigueModel fatigueModel)
    {
        _gradeAdjustment = gradeAdjustment;
        _fatigueModel = fatigueModel;
    }

    public FatigueModel FatigueModel => _fatigueModel;

    public void Predict(IReadOnlyList<Segment> segments, double flatSpeed)
    {
        double cumulativeLkm = 0;
        foreach (var seg in segments)
        {
            double segLkm = seg.Distance / 1000.0
                          + seg.TotalAscend;

            double speed = PredictedSpeed(seg, cumulativeLkm, flatSpeed);
            seg.MeanSpeed = speed;

            cumulativeLkm += segLkm;
        }
    }

    private double PredictedSpeed(Segment seg, double cumulativeLkm, double raceDayFlatSpeed)
    {
        double gradeAdjustment = _gradeAdjustment.Evaluate(seg.Gradient);
        double fatigue = _fatigueModel.GetMultiplier(cumulativeLkm);
        return raceDayFlatSpeed * fatigue / gradeAdjustment;
    }
}
