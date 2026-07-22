Feature: Golden path
  A new user can sign up, create a portfolio, import holdings, and see
  the results reflected on the dashboard.

  Scenario: Signup, create portfolio, import CSV, see dashboard results
    Given a new user visits the signup page
    When they sign up with a fresh email and a valid password
    Then they land on the dashboard, logged in
    When they create a portfolio named "E2E Pilot Portfolio"
    And they import the sample holdings CSV
    Then the import succeeds
    And the dashboard shows the imported holdings
    And the dashboard KPIs reflect a non-zero total value
