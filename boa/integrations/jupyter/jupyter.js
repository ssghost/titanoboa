/**
 * This file is loaded by Jupyter Notebook and JupyterLab to expose the
 * BrowserSigner to the frontend.
 */
(() => {
    let provider; // cache the provider to avoid re-creating it every time
    const getEthersProvider = () => {
        if (provider) return provider;
        const {ethereum} = window;
        if (!ethereum) {
            throw new Error('No Ethereum plugin found. Please authorize the site on your browser wallet.');
        }
        return provider = new ethers.BrowserProvider(ethereum);
    };

    /** Stringify data, converting big ints to strings */
    const stringify = (data) => JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

    /** Get the value of a cookie with the given name */
    const getCookie = (name) => (document.cookie.match(`\\b${name}=([^;]*)\\b`))?.[1];

    /** Converts a success/failed promise into an object with either a data or error field */
    const parsePromise = promise => promise.then(data => ({data})).catch(error => ({
        error: Object.keys(error).length ? error : {
            message: error.message, // the default error object doesn't have enumerable properties
            stack: error.stack
        }
    }));

    /** Async sleep for the given time */
    const sleep = time => new Promise(resolve => setTimeout(resolve, time));

    const colab = window.colab ?? window.google?.colab; // in the parent window or in an iframe
    /** Calls the callback endpoint with the given token and body */
    async function callbackAPI(token, body) {
        const headers = {['X-XSRFToken']: getCookie('_xsrf')};
        const init = {method: 'POST', body, headers};
        const url = `../titanoboa_jupyterlab/callback/${token}`;
        const response = await fetch(url, init);
        return response.text();
    }

    const getSigner = () => getEthersProvider().getSigner();

    /** Load the signer via ethers user */
    const loadSigner = () => getSigner().then(s => s.getAddress());

    /** Sign a transaction via ethers */
    const sendTransaction = transaction => getSigner().then(s => s.sendTransaction(transaction));

    /** Sign a typed data via ethers */
    const signTypedData = (domain, types, value) => getSigner().then(s => s.signTypedData(domain, types, value));

    /** Call an RPC method via ethers */
    const rpc = (method, params) => getEthersProvider().send(method, params);

    /** Wait until the transaction is mined */
    const waitForTransactionReceipt = async (tx_hash, timeout, poll_latency) => {
        while (true) {
            try {
                const result = await rpc('eth_getTransactionReceipt', [tx_hash]);
                if (result) {
                    return result;
                }
            } catch (err) { // ignore "server error" (happens while transaction is mined)
                if ((err?.info || err)?.error?.code !== -32603) {
                    throw err;
                }
            }
            if (timeout < poll_latency) {
                throw new Error('Timeout waiting for transaction receipt');
            }
            await sleep(poll_latency);
            timeout -= poll_latency;
        }
    };

    /** Call multiple RPCs in sequence */
    const multiRpc = (payloads) => payloads.reduce(
        async (previousPromise, [method, params]) => [...await previousPromise, await rpc(method, params)],
        [],
    );

    /** Call the backend when the given function is called, handling errors */
    const handleCallback = func => async (token, ...args) => {
        if (!colab) {
            // Check if the cell was already executed. In Colab, eval_js() doesn't replay.
            const response = await fetch(`../titanoboa_jupyterlab/callback/${token}`);
            // !response.ok indicates the cell has already been executed
            if (!response.ok) return;
        }

        const body = stringify(await parsePromise(func(...args)));
        // console.log(`Boa: ${func.name}(${args.map(a => JSON.stringify(a)).join(',')}) = ${body};`);
        if (colab) {
            return body;
        }
        await callbackAPI(token, body);
    };

    // expose functions to window, so they can be called from the BrowserSigner
    window._titanoboa = {
        loadSigner: handleCallback(loadSigner),
        sendTransaction: handleCallback(sendTransaction),
        signTypedData: handleCallback(signTypedData),
        waitForTransactionReceipt: handleCallback(waitForTransactionReceipt),
        rpc: handleCallback(rpc),
        multiRpc: handleCallback(multiRpc),
    };
})();
