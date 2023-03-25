var Kube = {
    params: {},
    metrics_endpoint: undefined,

    setParams: function (params) {
        ['api_token', 'api_url', 'state_endpoint_name'].forEach(function (field) {
            if (typeof params !== 'object' || typeof params[field] === 'undefined'
                || params[field] === '') {
                throw 'Required param is not set: "' + field + '".';
            }
        });

        Kube.params = params;
    },

    request: function (query) {
        const request = new HttpRequest();
        request.addHeader('Content-Type: application/json');
        request.addHeader('Authorization: Bearer ' + Kube.params.api_token);

        const url = Kube.params.api_url + query;
        Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

        var response = request.get(url);
        Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus());
        Zabbix.log(5, response);

        if (request.getStatus() < 200 || request.getStatus() >= 300) {
            throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
        }

        if (response) {
            try {
                response = JSON.parse(response);
            }
            catch (error) {
                throw 'Failed to parse response received from Kubernetes API. Check debug log for more information.';
            }
        }

        return {
            status: request.getStatus(),
            response: response
        };
    },

    getMetricsEndpoint: function () {
        var result = Kube.request('/api/v1/endpoints'),
            endpoint = undefined;

        if (typeof result.response !== 'object'
            || typeof result.response.items === 'undefined'
            || result.status != 200) {
            throw 'Cannot get endpoints from Kubernetes API. Check debug log for more information.';
        };

        result.response.items.forEach(function (ep) {
            if (ep.metadata.name !== Kube.params.state_endpoint_name) {
                return;
            }
            if (!Array.isArray(ep.subsets)) {
                return;
            }
            if (!ep.subsets[0].addresses) {
                return;
            }

            var scheme, addr, port;
            ep.subsets.forEach(function (subset) {
                var lp = subset.ports.filter(function (port) {
                    if (port.name !== 'http' &&
                        port.name !== 'https' &&
                        port.name !== 'https-main') {
                        return false;
                    }
                    scheme = port.name.match(/https?/);
                    return true;
                });

                if (lp.length) {
                    port = lp[0].port;
                    addr = subset.addresses[0].ip;
                }
            });

            endpoint = {
                scheme: scheme || 'http',
                address: addr || ep.subsets[0].addresses[0].ip,
                port: port || 8080
            };
        });

        Kube.metrics_endpoint = endpoint;
        return endpoint;
    },

    getStateMetrics: function () {
        if (typeof Kube.metrics_endpoint === 'undefined') {
            throw 'Cannot get kube-state-metrics endpoints from Kubernetes API. Check debug log for more information.';
        }

        const request = new HttpRequest();
        request.addHeader('Content-Type: application/json');
        request.addHeader('Authorization: Bearer ' + Kube.params.api_token);

        const url = Kube.metrics_endpoint.scheme + '://' + Kube.metrics_endpoint.address + ':' + Kube.metrics_endpoint.port + '/metrics';
        Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

        var response = request.get(url);
        Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus());
        Zabbix.log(5, response);

        if (request.getStatus() < 200 || request.getStatus() >= 300) {
            throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
        }

        if (response === null) {
            throw 'failed to get Kubernetes state metrics. Check debug log for more information.';
        }

        return response;
    }
};

try {
    Kube.setParams(JSON.parse(value));

    var metricsEndpoint = Kube.getMetricsEndpoint(),
        stateMetrics = Kube.getStateMetrics();

    return stateMetrics;
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes ] ERROR: ' + error);
    return JSON.stringify({ error: error });
}
