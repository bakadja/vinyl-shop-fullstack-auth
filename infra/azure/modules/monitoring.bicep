param tags object
param appId string
param databaseId string
param actionGroupResourceId string
var rules = [
  { name: 'http-errors', scope: appId, namespace: 'Microsoft.Web/sites', metric: 'Http5xx', aggregation: 'Total', operator: 'GreaterThan', threshold: 5 }
  { name: 'database-storage', scope: databaseId, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'storage_percent', aggregation: 'Average', operator: 'GreaterThan', threshold: 80 }
  { name: 'database-connections', scope: databaseId, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'active_connections', aggregation: 'Average', operator: 'GreaterThan', threshold: 25 }
]
resource alerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for rule in rules: {
  name: '${rule.name}-${uniqueString(appId)}'
  location: 'global'
  tags: tags
  properties: {
    description: 'Student demo operational alert; enabled only with an existing action group.'
    severity: 2
    enabled: !empty(actionGroupResourceId)
    scopes: [rule.scope]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: rule.name, metricName: rule.metric, metricNamespace: rule.namespace, timeAggregation: rule.aggregation, operator: rule.operator, threshold: rule.threshold, criterionType: 'StaticThresholdCriterion' }]
    }
    actions: empty(actionGroupResourceId) ? [] : [{ actionGroupId: actionGroupResourceId }]
  }
}]
