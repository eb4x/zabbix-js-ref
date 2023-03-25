var Kube = {
    params: {},

    setParams: function (params) {
        ['api_token', 'api_url',
         'controller_scheme', 'controller_port',
         'scheduler_scheme', 'scheduler_port'].forEach(function (field) {
            if (typeof params !== 'object' || typeof params[field] === 'undefined'
                || params[field] === '') {
                throw 'Required param is not set: "' + field + '".';
            }
        });

        Kube.params = params;

        /* This regex can be broken down into the following components
         *
         * (?:(?<scheme>https?):\/\/)
         * (?<host>[^:/]+)
         * (?::(?<port>\d+))
         */
        const match = Kube.params.api_url.match(/(?:(https?):\/\/)([^:/]+)(?::(\d+))/);
        if (!match) {
            Zabbix.log(4, '[ Kubernetes ] Received incorrect Kubernetes API url: ' + Kube.params.api_url + '. Expected format: <scheme>://<host>:<port>');
            throw 'Cannot get host from Kubernetes API url. Check debug log for more information.';
        }

        Kube.params.api_scheme = match[1];
        Kube.params.api_hostname = match[2];
        Kube.params.api_port = match[3];
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

    getNodes: function () {
        var result = Kube.request('/api/v1/nodes');

        if (typeof result.response !== 'object'
            || typeof result.response.items === 'undefined'
            || result.status != 200) {
            throw 'Cannot get nodes from Kubernetes API. Check debug log for more information.';
        }

        return result.response.items;
    },
};

try {
    Kube.setParams(JSON.parse(value));

    // if we could turn this into a multi-label selector somehow;
    // /api/v1/nodes?labelSelector=node-role.kubernetes.io/control-plane
    // for now we're stuck with filtering down the nodes manually
    const nodes = Kube.getNodes().filter(function (node) {
        return ('node-role.kubernetes.io/control-plane' in node.metadata.labels ||
                'node-role.kubernetes.io/master' in node.metadata.labels);
    });

    const isIPv4 = /(\d+\.){3}\d+/;

    const controlPlaneNodes = [];
    nodes.forEach(function (node) {
        var internalIPs = node.status.addresses.filter(function (addr) {
            return addr.type === 'InternalIP';
        });
        var internalIP = internalIPs.length && internalIPs[0].address;

        controlPlaneNodes.push({
            '{#NAME}': node.metadata.name,
            '{#IP}': internalIP,
            '{#KUBE.API.SERVER.URL}':        Kube.params.api_scheme        + '://' + (isIPv4.test(internalIP) ? internalIP : '['+internalIP+']') + ':' + Kube.params.api_port        + '/metrics',
            '{#KUBE.CONTROLLER.SERVER.URL}': Kube.params.controller_scheme + '://' + (isIPv4.test(internalIP) ? internalIP : '['+internalIP+']') + ':' + Kube.params.controller_port + '/metrics',
            '{#KUBE.SCHEDULER.SERVER.URL}':  Kube.params.scheduler_scheme  + '://' + (isIPv4.test(internalIP) ? internalIP : '['+internalIP+']') + ':' + Kube.params.scheduler_port  + '/metrics',
            '{#COMPONENT.API}' : 'API',
            '{#COMPONENT.CONTROLLER}' : 'Controller manager',
            '{#COMPONENT.SCHEDULER}' : 'Scheduler',
            '{#CLUSTER_HOSTNAME}': Kube.params.api_hostname
        });
    });

    return JSON.stringify(controlPlaneNodes);
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes ] ERROR: ' + error);
    return JSON.stringify({ error: error });
}
