Feature: Tab navigation
  Signed-in users can switch between tools without losing in-progress work,
  and open/close the API Keys modal from any tab.

  Background:
    Given a new user visits the signup page
    When they sign up with a fresh email and a valid password
    Then they land on the dashboard, logged in

  Scenario: Switching tabs preserves in-progress state
    When they type "AAPL" into the Momentum ticker input
    And they switch to the "Contrarian Finder" tab
    And they switch to the "Momentum Analysis" tab
    Then the Momentum ticker input still shows "AAPL"

  Scenario: API Keys modal opens and closes from any tab
    Given they have been granted the "api_keys:manage_own" permission
    When they open the API Keys modal
    Then the API Keys modal is visible
    When they close the API Keys modal
    Then the API Keys modal is not visible
