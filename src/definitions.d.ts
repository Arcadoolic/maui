interface ControllerMapping {
    buttons: {[key: number]: string};
    axes: {[key: number]: {[value: number]: string}};
}

interface Nplayers {
    sim: number;
    alt: number;
}
