---
id: "a74d518f-8939-47bd-b4c8-55e89884a0be"
term: "Conditional expectation"
label: "条件期望"
created: "2026-09-09T15:30:22.751Z"
updated: "2026-09-09T15:30:22.751Z"
kind: "concept"
links: []
---

# Conditional expectation · 条件期望

## 概念解释

条件期望是指在给定另一个随机变量（或事件）取特定值的条件下，某个随机变量的期望值。它是对条件分布求平均的结果，反映了在已知部分信息后对该变量的平均预测。

## 在原文中的用法

在此摘录中，条件期望被定义为通过条件密度函数 $f_{Y|X}(y \mid x)$ 对 $y$ 进行积分得到的表达式，即 $\mathbb{E}[Y \mid X = x] = \int y f_{Y|X}(y \mid x) dy$。这要求 $X$ 和 $Y$ 是连续型随机变量，且条件密度存在。该公式用于计算给定 $X=x$ 时 $Y$ 的平均值。

## 原文

**Conditional expectation**

Conditional expectation can be expressed using a conditional density:

$$\mathbb{E}[Y \mid X = x] = \int_{-\infty}^{\infty} y f_{Y|X}(y \mid x) \, \mathrm{d}y.$$

The sample mean and a symmetric matrix are:

$$\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i, \qquad A = \begin{pmatrix} a & b \\ b & c \end{pmatrix}.$$

## 我的理解
