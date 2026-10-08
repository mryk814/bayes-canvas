import unittest
import numpy as np
from gaussian_collapse import joint, collapsed, recover, independent_recovery


GROUPS = [[], [None, 2.1], [1.2, None, 1.5], [2 + j / 10 for j in range(7)], [3 + j / 100 for j in range(50)], [None, None]]


class GaussianCollapseTests(unittest.TestCase):
    def test_mean_covariance_and_log_evidence(self):
        for tau, sigma in [(1.3, 0.7), (0.2, 3.0), (4.0, 0.1)]:
            with self.subTest(tau=tau, sigma=sigma):
                a = joint(GROUPS, m0=0.4, s0=2.0, tau=tau, sigma=sigma)
                b = collapsed(GROUPS, m0=0.4, s0=2.0, tau=tau, sigma=sigma)
                np.testing.assert_allclose(a['mean'], b['mean'], atol=1e-10, rtol=1e-10)
                np.testing.assert_allclose(a['cov'], b['cov'], atol=1e-10, rtol=1e-10)
                self.assertAlmostEqual(a['log_evidence'], b['log_evidence'], places=8)

    def test_no_observations_is_joint_prior(self):
        b = collapsed([[], [None]], m0=2., s0=3., tau=4., sigma=1.)
        np.testing.assert_allclose(b['mean'], [2., 2., 2.])
        np.testing.assert_allclose(b['cov'], [[9., 9., 9.], [9., 25., 9.], [9., 9., 25.]])
        self.assertEqual(b['log_evidence'], 0.)
        a = joint([[], [None]], m0=2., s0=3., tau=4., sigma=1.)
        np.testing.assert_allclose(a['mean'], b['mean'])
        np.testing.assert_allclose(a['cov'], b['cov'])
        self.assertEqual(a['log_evidence'], 0.)

    def test_mask_and_group_permutation(self):
        opts = dict(m0=0., s0=2., tau=1., sigma=.7)
        a = collapsed(GROUPS, **opts)
        clean = [[x for x in g if x is not None] for g in GROUPS]
        np.testing.assert_allclose(a['cov'], collapsed(clean, **opts)['cov'])
        order = [5, 2, 0, 4, 1, 3]
        p = [0] + [g + 1 for g in order]
        b = collapsed([GROUPS[g] for g in order], **opts)
        np.testing.assert_allclose(b['mean'], a['mean'][p])
        np.testing.assert_allclose(b['cov'], a['cov'][np.ix_(p, p)])
        self.assertAlmostEqual(a['log_evidence'], b['log_evidence'])

    def test_conditional_draws_preserve_joint_covariance(self):
        b = collapsed(GROUPS, m0=0., s0=2., tau=1., sigma=.7)
        for seed in (17, 913):
            x = recover(b, 160000, seed)
            np.testing.assert_allclose(x.mean(axis=0), b['mean'], atol=.012, rtol=0)
            np.testing.assert_allclose(np.cov(x, rowvar=False), b['cov'], atol=.022, rtol=0)

    def test_wrong_independent_recovery_is_detected(self):
        b = collapsed([[], [1., None], []], m0=0., s0=2., tau=1., sigma=1.)
        bad = independent_recovery(b, 160000, 17)
        covariance = np.cov(bad, rowvar=False)
        np.testing.assert_allclose(bad.mean(axis=0), b['mean'], atol=.02, rtol=0)
        np.testing.assert_allclose(np.diag(covariance), np.diag(b['cov']), atol=.025, rtol=0)
        self.assertGreater(abs(covariance[1, 3] - b['cov'][1, 3]), .5)
        with self.assertRaises(AssertionError):
            np.testing.assert_allclose(covariance, b['cov'], atol=.025, rtol=0)

    def test_invalid_inputs_rejected(self):
        for f in (joint, collapsed):
            for opts in [dict(tau=0.), dict(sigma=-1.), dict(s0=float('nan'))]:
                with self.assertRaises(ValueError):
                    f([[1.]], **opts)
            with self.assertRaises(ValueError):
                f([[float('nan')]])


if __name__ == '__main__':
    unittest.main()
