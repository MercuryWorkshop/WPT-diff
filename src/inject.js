add_completion_callback = new Proxy(add_completion_callback, {
    apply(target, that, args) {
        const [originalListener] = args;
        args[0] = (tests, harness_status, asserts_run) => {
            collectWPTResults(location.href, tests, harness_status, asserts_run);
            originalListener(...arguments);
        }
    }
})