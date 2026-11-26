"""Use a disposable MySQL database for the registration ownership flow."""
import unittest

import test_mysql
from test_registration import RegistrationCases


class MysqlRegistrationTest(RegistrationCases, test_mysql.MysqlTest):
    pass


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(MysqlRegistrationTest(name) for name in sorted(vars(RegistrationCases)) if name.startswith('test_'))
