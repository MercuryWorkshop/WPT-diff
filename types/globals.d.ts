declare global {
	interface Window {
		$scramjet: {
			codec: {
				decode: (url: string) => string;
			};
		};
	}
}
