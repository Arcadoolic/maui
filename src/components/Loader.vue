<template>
    <div>
        <div id="loading">
            <div class="outer-shadow"></div>
            <div class="timer">
                <div class="hold" id="left">
                    <div class="pie" :style="leftPieStyle"></div>
                </div>
                <div class="hold" id="right">
                    <div class="pie" :style="rightPieStyle"></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import {Component, Prop, Vue} from 'vue-property-decorator';

@Component
    export default class Loader extends Vue {
        @Prop({default: 2})
        protected duration!: number;

        public created() {
            console.log(this.duration);
        }

        protected get leftPieStyle() {
            return {
                'animation-duration': ['-webkit-', this.duration / 2 + 's'],
            };
        }

        protected get rightPieStyle() {
            return {
                'animation-duration': ['-webkit-', this.duration / 2 + 's'],
                'animation-delay': ['-webkit-', this.duration / 2 + 's'],
            };
        }


    }
</script>

<style scoped>
    #loading {
        width: 100px;
        height: 100px;
        margin: 30px auto;
        position: relative;
    }

    .outer-shadow, .inner-shadow, #timer {
        z-index: 6;
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 100%;
        box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.2);
    }

    #timer {
        z-index: 1;
        box-shadow: none;
    }

    .hold {
        position: absolute;
        width: 100%;
        height: 100%;
        clip: rect(0px, 100px, 100px, 50px);
        -webkit-border-radius: 100%;
        background-color: rgba(0,0,0,0);
    }

    .pie, .dot span {
        background-color: #f50;
    }

    .pie {
        position: absolute;
        width: 100%;
        height: 100%;
        -webkit-border-radius: 100%;
        clip: rect(0px, 50px, 100px, 0px);
    }

    #left .pie {
        z-index: 1;
        -webkit-animation: left linear both;
    }

    @-webkit-keyframes left {
        0% {
            -webkit-transform: rotate(0deg);
        }
        100% {
            -webkit-transform: rotate(180deg);
        }
    }
    #right {
        z-index: 3;
        -webkit-transform: rotate(180deg);
    }

    #right .pie {
        -webkit-animation: right linear both;
    }

    @-webkit-keyframes right {
        0% {
            -webkit-transform: rotate(0deg);
        }
        100% {
            -webkit-transform: rotate(180deg);
        }
    }

</style>
