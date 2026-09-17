<template>
    <div class="categories">
        <div class="category" :class="getCategoryClasses(0)"></div>
        <div
            class="category"
            v-for="(category, index) in categories"
            :key="category.id_category"
            :class="getCategoryClasses(index + 1)"
        ></div>
    </div>
</template>

<script setup lang="ts">
import Category from '@/model/Category.model';

const props = withDefaults(defineProps<{
    categories: Category[];
    selectedCategoryIndex?: number;
}>(), {selectedCategoryIndex: 0});

function getCategoryClasses(index: number) {
    const catLen = props.categories.length + 1;
    let previous = props.selectedCategoryIndex - 1 === index;
    let previous2 = props.selectedCategoryIndex - 2 === index;
    let next2 = props.selectedCategoryIndex + 2 === index;
    if (props.selectedCategoryIndex === 0) {
        previous = index === catLen - 1;
        previous2 = index === catLen - 2;
    } else if (props.selectedCategoryIndex === 1) {
        previous2 = catLen - 1 === index;
    }

    let next = props.selectedCategoryIndex + 1 === index;
    if (props.selectedCategoryIndex === catLen - 1) {
        next = 0 === index;
        next2 = 1 === index;
    } else if (props.selectedCategoryIndex === catLen - 2) {
        next2 = 0 === index;
    }

    const classes: {[key: string]: boolean} = {
        selected: props.selectedCategoryIndex === index,
        previous,
        next,
        previous2,
        next2,
    };
    if (index > 0) {
        // Strip mame's "TTL * " prefix (discrete-logic games, e.g. "TTL * Shooter") first - same
        // icon as the non-TTL category since it's the same kind of game. The replace() needs /g:
        // without it, only the first run of separators became '_' and any later one (e.g. the
        // second space in "Musical Instrument Accessory") stayed literal, breaking the class name.
        const name = props.categories[index - 1].name.replace(/^TTL \* /, '');
        const classLogo = name.replace(/[\s\W]+/g, '_').toLowerCase();
        classes[classLogo] = true;
    }
    return classes;
}
</script>

<style scoped>
    .categories {
        width: 25%;
        height: 0;
        padding-bottom: 25%;
        position: absolute;
        display: block;
        right: -12%;
        bottom: -25%;
    }

    .categories .category {
        position: absolute;
        display: none;
        width: 30%;
        height: 30%;
        transition: all .3s ease;
        background-position: center;
        background-repeat: no-repeat;
        background-size: contain;
        background-image: url(../assets/categories/_default.svg);
    }

    .categories .category.next2 {
        display: block;
        transform: translate3d(200%, -50%, 0) scale(0.4);
    }

    .categories .category.next {
        display: block;
        transform: translate3d(100%, -50%, 0) scale(0.7);
    }

    .categories .category.selected {
        display: block;
        transform: translate3d(0, 0, 0) scale(1.2);
    }

    .categories .category.previous {
        display: block;
        transform: translate3d(-50%, 100%, 0) scale(0.7);
    }

    .categories .category.previous2 {
        display: block;
        transform: translate3d(-50%, 200%, 0) scale(0.4);
    }

    .categories .category.ball_paddle {
        background-image: url(../assets/categories/ball_paddle.svg);
    }

    .categories .category.climbing {
        background-image: url(../assets/categories/climbing.svg);
    }

    .categories .category.driving {
        background-image: url(../assets/categories/driving.svg);
    }

    .categories .category.fighter {
        background-image: url(../assets/categories/fighter.svg);
    }

    .categories .category.maze {
        background-image: url(../assets/categories/maze.svg);
    }

    .categories .category.multiplay {
        background-image: url(../assets/categories/multiplay.svg);
    }

    .categories .category.music {
        background-image: url(../assets/categories/music.svg);
    }

    .categories .category.platform {
        background-image: url(../assets/categories/platform.svg);
    }

    .categories .category.puzzle {
        background-image: url(../assets/categories/puzzle.svg);
    }

    .categories .category.quiz {
        background-image: url(../assets/categories/quiz.svg);
    }

    .categories .category.shooter {
        background-image: url(../assets/categories/shooter.svg);
    }

    .categories .category.sports {
        background-image: url(../assets/categories/sports.svg);
    }


    /* Selected one */
    /*.categories .category[data-pos='0'] {*/
    /*display: block;*/
    /*transform: translateX(100%) translateY(100%);*/
    /*animation: xAxis 2.5s infinite, yAxis 2.5s infinite;*/
    /*top: 30%;*/
    /*left: 30%;*/
    /*}*/

    /*.categories .category[data-pos='-1'] {*/
    /*top: 10%;*/
    /*right: 0;*/
    /*display: block;*/
    /*}*/

    /*.categories .category[data-pos='-2'] {*/
    /*top: 10%;*/
    /*right: -30%;*/
    /*display: block;*/
    /*}*/

    /*.categories .category[data-pos='1'] {*/
    /*bottom: 0;*/
    /*left: 10%;*/
    /*display: block;*/
    /*}*/
    /*.categories .category[data-pos='2'] {*/
    /*bottom: -30%;*/
    /*left: 10%;*/
    /*display: block;*/
    /*}*/


    /*.categories figure {*/
    /*position: relative;*/
    /*height: 200px;*/
    /*margin: 0;*/
    /*padding: 0;*/
    /*transition: left 0.3s ease-in-out;*/
    /*}*/
    /*.categories figure .category {*/
    /*text-align: center;*/
    /*margin-top: 50px;*/
    /*width: 150px;*/
    /*float: left;*/
    /*height: 150px;*/
    /*transition: width 0.2s ease-in-out, height 0.2s ease-in-out, margin-top 0.2s ease-in-out, font-size 0.2s ease-in-out;*/
    /*bottom: 0;*/
    /*}*/
    /*.categories figure .category.first {*/
    /*margin-left: 150px;*/
    /*}*/
    /*.categories figure .category.selected {*/
    /*position: relative;*/
    /*margin-top: 0;*/
    /*width: 250px;*/
    /*height: 200px;*/
    /*z-index: 2;*/
    /*font-size: 2em;*/
    /*}*/
    /*.categories figure .category.previous {*/
    /*position: relative;*/
    /*margin-right: -40px;*/
    /*z-index: 1;*/
    /*}*/
    /*.categories figure .category.next {*/
    /*position: relative;*/
    /*margin-left: -40px;*/
    /*z-index: 1;*/
    /*}*/
</style>
