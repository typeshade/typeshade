var<private> calls: f32 = 0.0;

fn tally(x: f32) -> f32 {
  calls += 1.0;
  return x;
}
