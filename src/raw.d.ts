// `types: []` leaves out Vite's client declarations; `?raw` imports are declared here.
declare module "*?raw" {
    const text: string;
    export default text;
}
